/*
 * Brand kits in the studio: stored under <studio-data>/brands/<id>/ (brand.json, fonts/, assets/).
 * Seeded from the repo's brands/ on first run. Five base colours are expanded into the full token set.
 */
import fs from "node:fs";
import path from "node:path";
import { BrandKit } from "@vs/spec";
import { FONT_DIR, FONT_LIBRARY, deriveColors, type BaseColors } from "@vs/brand";
import { REPO, env, slug, vsaudio } from "@vs/render";
import { StudioError, cacheDir } from "./errors.ts";

export const brandsDir = () => env.brandsDir();
const bdir = (id: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new StudioError(400, "bad brand id");
  const d = path.join(brandsDir(), id);
  if (!fs.existsSync(path.join(d, "brand.json"))) throw new StudioError(404, `no brand "${id}"`);
  return d;
};

/** Point VS_BRANDS at the studio's brand folder and seed it from the repo. */
export function initBrands(home: string) {
  if (!process.env.VS_BRANDS) process.env.VS_BRANDS = path.join(home, "brands");
  const dst = process.env.VS_BRANDS;
  fs.mkdirSync(dst, { recursive: true });
  for (const id of fs.readdirSync(path.join(REPO, "brands"))) {
    if (fs.existsSync(path.join(REPO, "brands", id, "brand.json")) && !fs.existsSync(path.join(dst, id))) fs.cpSync(path.join(REPO, "brands", id), path.join(dst, id), { recursive: true });
  }
}

export const fontLibrary = () => FONT_LIBRARY.map((f) => ({ ...f, url: `/api/fonts/${f.file}` }));
export const fontFile = (file: string) => {
  const f = path.join(FONT_DIR, path.basename(file));
  if (!fs.existsSync(f)) throw new StudioError(404, "no such font");
  return f;
};

export function listBrandKits() {
  return fs.readdirSync(brandsDir()).filter((id) => fs.existsSync(path.join(brandsDir(), id, "brand.json"))).map((id) => brandView(id));
}

export function brandView(id: string) {
  const d = bdir(id);
  const kit = JSON.parse(fs.readFileSync(path.join(d, "brand.json"), "utf8"));
  const u = (f?: string) => (f ? `/brand/${id}/${f}` : undefined);
  return { ...kit, id, urls: { logoOnDark: u(kit.logo?.onDark), logoOnLight: u(kit.logo?.onLight), mark: u(kit.logo?.mark),
    fonts: Object.fromEntries(Object.entries(kit.fonts ?? {}).map(([r, f]: [string, any]) => [r, u(f.file)])) } };
}

export interface BrandInput {
  name: string;
  base: BaseColors;
  fonts: Record<"display" | "body" | "mono", { library?: string; family?: string; file?: string }>;
  voice?: { voice: string; speed: number };
  pronunciations?: Record<string, { ipa: string } | { respell: string }>;
  ctaUrl?: string;
  music?: string;
}

/** Create (no id) or update a brand. Logos/fonts uploaded separately via saveBrandFile. */
export function saveBrand(id: string | undefined, b: BrandInput) {
  if (!b.name?.trim()) throw new StudioError(400, "brand name is required");
  let d: string;
  if (!id) {
    id = slug(b.name).toLowerCase().replace(/_/g, "-").slice(0, 30) || "brand";
    if (!/^[a-z0-9]/.test(id)) id = "b-" + id;
    for (let n = 2; fs.existsSync(path.join(brandsDir(), id)); n++) id = id.replace(/-\d+$/, "") + "-" + n;
    d = path.join(brandsDir(), id);
    fs.mkdirSync(path.join(d, "fonts"), { recursive: true });
    fs.mkdirSync(path.join(d, "assets"), { recursive: true });
  } else d = bdir(id);
  const prev = fs.existsSync(path.join(d, "brand.json")) ? JSON.parse(fs.readFileSync(path.join(d, "brand.json"), "utf8")) : {};
  const fonts: Record<string, { family: string; file: string; weight?: string }> = {};
  for (const role of ["display", "body", "mono"] as const) {
    const f = b.fonts?.[role] ?? {};
    const fallback = { display: "onest", body: "opensans", mono: "jetbrains" }[role];
    const lib = FONT_LIBRARY.find((x) => x.id === f.library) ?? (!f.file ? FONT_LIBRARY.find((x) => x.id === fallback) : undefined);
    if (lib) {
      fs.mkdirSync(path.join(d, "fonts"), { recursive: true });
      fs.copyFileSync(path.join(FONT_DIR, lib.file), path.join(d, "fonts", lib.file));
      fonts[role] = { family: lib.family, file: `fonts/${lib.file}`, weight: lib.weight };
    } else {
      if (!f.file || !fs.existsSync(path.join(d, f.file))) throw new StudioError(400, `upload a ${role} font file first`);
      fonts[role] = { family: f.family || path.basename(f.file, path.extname(f.file)), file: f.file, weight: "100 900" };
    }
  }
  const logo = prev.logo ?? {};
  if (!logo.onDark && !logo.onLight) {
    // a text placeholder logo until one is uploaded
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200"><text x="400" y="138" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="120" fill="${b.base.primary}">${b.name.replace(/[<&>"]/g, "")}</text></svg>`;
    fs.mkdirSync(path.join(d, "assets"), { recursive: true });
    fs.writeFileSync(path.join(d, "assets", "logo.svg"), svg);
    logo.onDark = logo.onLight = "assets/logo.svg";
  }
  const kit = {
    id, name: b.name.trim(),
    base: b.base,
    colors: deriveColors(b.base),
    fonts, logo,
    voice: { provider: "kokoro", voice: b.voice?.voice ?? "af_heart", speed: b.voice?.speed ?? 0.94 },
    pronunciations: b.pronunciations ?? {},
    music: { preset: b.music ?? "uplifting-tech" },
    ...(b.ctaUrl ? { cta: { url: b.ctaUrl } } : {}),
  };
  const r = BrandKit.safeParse(kit);
  if (!r.success) throw new StudioError(422, "invalid brand", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  fs.writeFileSync(path.join(d, "brand.json"), JSON.stringify(kit, null, 2) + "\n");
  return brandView(id);
}

export type BrandFileKind = "logoOnDark" | "logoOnLight" | "mark" | "fontDisplay" | "fontBody" | "fontMono";
export function saveBrandFile(id: string, kind: BrandFileKind, filename: string, data: Buffer) {
  const d = bdir(id);
  const ext = path.extname(filename).toLowerCase();
  const isFont = kind.startsWith("font");
  if (isFont && ![".ttf", ".otf", ".woff2", ".woff"].includes(ext)) throw new StudioError(400, "fonts: .ttf, .otf, .woff2 or .woff");
  if (!isFont && ![".png", ".svg", ".webp", ".jpg", ".jpeg"].includes(ext)) throw new StudioError(400, "logos: .png, .svg, .webp or .jpg");
  if (ext === ".svg" && /<script|on\w+=|javascript:/i.test(data.toString("utf8"))) throw new StudioError(400, "SVG contains scripts; export it again without them");
  const sub = isFont ? "fonts" : "assets";
  const name = `${kind}${ext}`;
  fs.mkdirSync(path.join(d, sub), { recursive: true });
  fs.writeFileSync(path.join(d, sub, name), data);
  const kit = JSON.parse(fs.readFileSync(path.join(d, "brand.json"), "utf8"));
  const rel = `${sub}/${name}`;
  if (kind === "logoOnDark") kit.logo.onDark = rel;
  if (kind === "logoOnLight") kit.logo.onLight = rel;
  if (kind === "mark") kit.logo.mark = rel;
  if (isFont) {
    const role = kind.slice(4).toLowerCase() as "display" | "body" | "mono";
    kit.fonts[role] = { family: path.basename(filename, ext).replace(/[-_]?(Variable|VF|Regular)$/i, ""), file: rel, weight: "100 900" };
  }
  // one uploaded logo serves both backgrounds until the other is set
  if (kind === "logoOnDark" && kit.logo.onLight === "assets/logo.svg") kit.logo.onLight = rel;
  if (kind === "logoOnLight" && kit.logo.onDark === "assets/logo.svg") kit.logo.onDark = rel;
  fs.writeFileSync(path.join(d, "brand.json"), JSON.stringify(kit, null, 2) + "\n");
  return brandView(id);
}

export function deleteBrand(id: string) {
  if (id === "luraplus") throw new StudioError(400, "the example brand can't be deleted");
  fs.rmSync(bdir(id), { recursive: true, force: true });
}

/** Synthesize a test line with a voice + pronunciation dictionary; returns a WAV path. */
export async function testVoice(o: { text: string; voice?: string; speed?: number; pronunciations?: Record<string, unknown>; brand?: string }) {
  let dict = o.pronunciations;
  if (!dict && o.brand) dict = JSON.parse(fs.readFileSync(path.join(bdir(o.brand), "brand.json"), "utf8")).pronunciations ?? {};
  const r = await vsaudio<{ lines: { wav: string; dur: number; phonemes: string }[] }>("tts", {
    cacheDir: path.join(cacheDir(), "vo"), modelsDir: env.modelsDir(), voice: o.voice ?? "af_heart", speed: o.speed ?? 0.94, lang: "en-us",
    dictionary: dict ?? {}, lines: [{ id: "t", text: o.text.slice(0, 300), phonemes: null }],
  });
  return r.lines[0];
}
