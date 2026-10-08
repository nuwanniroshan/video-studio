/*
 * Loading a spec for rendering: migrate + validate, brand kit, content-addressed assets,
 * TTS (cached), and the resolved timeline per variant.
 */
import fs from "node:fs";
import path from "node:path";
import { BrandKit, effectiveScenes, listAssets, mapAssets, migrate, validateSpec, type Spec } from "@vs/spec";
import { resolve as resolveTiming, type ResolvedTimeline } from "@vs/timing";
import { LocalStore, hashJson, sha256File } from "@vs/storage";
import { env } from "./env.ts";
import { vsaudio } from "./vsaudio.ts";

export interface Project {
  specPath: string; specDir: string; spec: Spec; brand: BrandKit; brandDir: string; brandHash: string;
  store: LocalStore; assetUrls: Map<string, string>;
}
export class SpecError extends Error { constructor(msg: string, readonly issues: { path: string; message: string }[]) { super(msg); } }

export function loadProject(specPath: string, o: { cacheDir?: string; brandsDir?: string } = {}): Project {
  const raw = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const r = validateSpec(migrate(raw));
  if (!r.ok) throw new SpecError(`${specPath}: invalid spec`, r.issues);
  const spec = r.spec;
  // a project's own brand (<project>/brand/) wins over the shared brand kits
  const specDir0 = path.dirname(path.resolve(specPath));
  const brandsDir = o.brandsDir ?? env.brandsDir();
  const local = path.join(specDir0, "brand");
  const brandDir = fs.existsSync(path.join(local, "brand.json")) ? local : path.join(brandsDir, spec.brand);
  if (!fs.existsSync(path.join(brandDir, "brand.json"))) throw new SpecError(`brand "${spec.brand}" not found (no ${local} and not in ${brandsDir})`, [{ path: "brand", message: "unknown brand kit" }]);
  const brand = BrandKit.parse(JSON.parse(fs.readFileSync(path.join(brandDir, "brand.json"), "utf8")));
  const files = [brand.fonts.display.file, brand.fonts.body.file, brand.fonts.mono.file, brand.logo.onDark, brand.logo.onLight].filter((f) => fs.existsSync(path.join(brandDir, f)));
  const brandHash = hashJson({ kit: brand, files: files.map((f) => sha256File(path.join(brandDir, f))) });
  const store = new LocalStore(o.cacheDir ?? env.cacheDir());
  const specDir = specDir0;
  // content-address every referenced asset
  const assetUrls = new Map<string, string>();
  for (const s of spec.scenes) {
    const props = [s.props, ...Object.values(s.aspectOverrides ?? {}).map((x) => x!.props), ...spec.variants.map((v) => v.overrides?.[s.id]?.props).filter(Boolean)];
    for (const p of props) for (const a of listAssets(s.type, { ...(s.props as object), ...(p as object) })) {
      if (assetUrls.has(a.ref)) continue;
      if (a.ref.startsWith("sha256:")) {
        const f = store.findAsset(a.ref.slice(7));
        if (!f) throw new SpecError(`asset ${a.ref} is not in the store`, [{ path: `scenes.${s.id}.props.${a.path}`, message: "missing asset" }]);
        assetUrls.set(a.ref, `/assets/${path.basename(f)}`);
      } else {
        const f = path.resolve(specDir, a.ref);
        if (!fs.existsSync(f)) throw new SpecError(`asset not found: ${a.ref}`, [{ path: `scenes.${s.id}.props.${a.path}`, message: `missing file ${f}` }]);
        assetUrls.set(a.ref, `/assets/${store.putAsset(f).name}`);
      }
    }
  }
  return { specPath, specDir, spec, brand, brandDir, brandHash, store, assetUrls };
}

export const assetUrlProps = (p: Project, type: string, props: unknown) => mapAssets(type, props, (ref) => p.assetUrls.get(ref) ?? ref);

export interface VoInfo { wav: string; dur: number; phonemes: string; cached: boolean }
const lineKey = (text: string, phonemes?: string) => hashJson({ text, phonemes });

/** TTS for every VO line used by the given variants (cached by vsaudio). Returns text-keyed results. */
export async function synthVoices(p: Project, variants: string[]): Promise<Map<string, VoInfo>> {
  const voice = p.spec.voice.provider === "kokoro" ? p.spec.voice : { voice: "af_heart", speed: 0.94 };
  const lines = new Map<string, { id: string; text: string; phonemes: string | null }>();
  for (const v of variants) for (const s of effectiveScenes(p.spec, v)) for (const l of s.vo) {
    const k = lineKey(l.text, l.phonemes);
    if (!lines.has(k)) lines.set(k, { id: k, text: l.text, phonemes: l.phonemes ?? null });
  }
  const out = new Map<string, VoInfo>();
  if (!lines.size) return out;
  const r = await vsaudio<{ lines: { id: string; wav: string; dur: number; phonemes: string; cached: boolean }[] }>("tts", {
    cacheDir: p.store.dir("vo"), modelsDir: env.modelsDir(), voice: voice.voice, speed: voice.speed, lang: "en-us",
    dictionary: p.brand.pronunciations, lines: [...lines.values()],
  });
  for (const l of r.lines) out.set(l.id, { wav: l.wav, dur: l.dur, phonemes: l.phonemes, cached: l.cached });
  return out;
}

export function resolveVariant(p: Project, variant: string, vo: Map<string, VoInfo>): ResolvedTimeline {
  return resolveTiming(p.spec, variant, (_sid, line) => {
    const l = line as { text: string; phonemes?: string };
    const info = vo.get(lineKey(l.text, l.phonemes));
    if (!info) throw new Error(`no TTS for line "${l.text}"`);
    return info.dur;
  });
}
export const voFor = (vo: Map<string, VoInfo>, text: string, phonemes?: string) => vo.get(lineKey(text, phonemes));
