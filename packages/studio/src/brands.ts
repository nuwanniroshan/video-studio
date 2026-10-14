/*
 * Brands belong to projects: <project>/brand/ holds brand.json, fonts/ and assets/ (logos). There is no
 * shared brand library. A project starts from a theme (themes/*.json: five colours, fonts, music, voice)
 * or from the user's own colours, fonts and logos. Five base colours are expanded into the full token set.
 */
import fs from "node:fs";
import path from "node:path";
import { BrandKit } from "@vs/spec";
import { FONT_DIR, FONT_LIBRARY, deriveColors, type BaseColors } from "@vs/brand";
import { REPO, env, vsaudio } from "@vs/render";
import { StudioError, cacheDir, pdir, projectsDir } from "./errors.ts";

type Role = "display" | "body" | "mono";
const ROLES: Role[] = ["display", "body", "mono"];

/* ---------- themes ---------- */

export interface Theme {
  id: string; name: string; description: string; category: string; order: number;
  base: BaseColors; fonts: Record<Role, string>; music: string; voice: { voice: string; speed: number };
}
const THEMES = path.join(REPO, "themes");
export function listThemes() {
  return fs.readdirSync(THEMES).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(THEMES, f), "utf8")) as Theme)
    .sort((a, b) => a.order - b.order).map((t) => ({ ...t, colors: deriveColors(t.base),
      fontFamilies: Object.fromEntries(ROLES.map((r) => [r, FONT_LIBRARY.find((x) => x.id === t.fonts[r])?.family ?? t.fonts[r]])) as Record<Role, string>,
      fontUrls: Object.fromEntries(ROLES.map((r) => [r, `/api/fonts/${FONT_LIBRARY.find((x) => x.id === t.fonts[r])?.file}`])) as Record<Role, string> }));
}
export function getTheme(id: string): Theme {
  const t = listThemes().find((x) => x.id === id);
  if (!t) throw new StudioError(400, `unknown theme "${id}". Themes: ${listThemes().map((x) => x.id).join(", ")}`);
  return t;
}

/* ---------- fonts ---------- */

export const fontLibrary = () => FONT_LIBRARY.map((f) => ({ ...f, url: `/api/fonts/${f.file}` }));
export const fontFile = (file: string) => {
  const f = path.join(FONT_DIR, path.basename(file));
  if (!fs.existsSync(f)) throw new StudioError(404, "no such font");
  return f;
};

/* ---------- writing a brand folder ---------- */

export interface BrandInput {
  name: string;
  base: BaseColors;
  fonts?: Partial<Record<Role, { library?: string; family?: string; file?: string }>>;
  voice?: { voice: string; speed: number };
  pronunciations?: Record<string, { ipa: string } | { respell: string }>;
  ctaUrl?: string;
  music?: string;
  /** the theme this brand started from (informational) */
  theme?: string;
}

const esc = (s: string) => s.replace(/[<&>"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Text logo used until the user uploads one: the name in a heavy system sans, white for dark scenes, ink for light. */
function wordmark(dir: string, name: string, ink: string) {
  const w = Math.max(360, Math.round(name.length * 74 + 60));
  const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="180" viewBox="0 0 ${w} 180"><text x="${w / 2}" y="128" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-weight="700" font-size="120" letter-spacing="-3" fill="${fill}">${esc(name)}</text></svg>`;
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "wordmark-dark.svg"), svg("#FFFFFF"));
  fs.writeFileSync(path.join(dir, "assets", "wordmark-light.svg"), svg(ink));
}
const isWordmark = (f?: string) => !f || /^assets\/(wordmark-(dark|light)|logo)\.svg$/.test(f);

/** Write <dir>/brand.json (+ fonts, wordmark) from a BrandInput. Keeps uploaded logos and fonts already in the folder. */
export function writeBrand(dir: string, id: string, b: BrandInput) {
  if (!b.name?.trim()) throw new StudioError(400, "brand name is required");
  fs.mkdirSync(path.join(dir, "fonts"), { recursive: true });
  const prev = fs.existsSync(path.join(dir, "brand.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "brand.json"), "utf8")) : {};
  const fallback: Record<Role, string> = { display: "onest", body: "opensans", mono: "jetbrains" };
  const fonts = {} as Record<Role, { family: string; file: string; weight?: string }>;
  for (const role of ROLES) {
    const f: { library?: string; family?: string; file?: string } = b.fonts?.[role] ?? (prev.fonts?.[role] ? { family: prev.fonts[role].family, file: prev.fonts[role].file } : {});
    const lib = FONT_LIBRARY.find((x) => x.id === f.library || (!f.library && f.file === `fonts/${x.file}`))
      ?? (!f.file ? FONT_LIBRARY.find((x) => x.id === fallback[role]) : undefined);
    if (lib) {
      fs.copyFileSync(path.join(FONT_DIR, lib.file), path.join(dir, "fonts", lib.file));
      fonts[role] = { family: lib.family, file: `fonts/${lib.file}`, weight: lib.weight };
    } else {
      if (!f.file || !fs.existsSync(path.join(dir, f.file))) throw new StudioError(400, `upload a ${role} font file first`);
      fonts[role] = { family: f.family || path.basename(f.file, path.extname(f.file)), file: f.file, weight: "100 900" };
    }
  }
  const logo = { ...(prev.logo ?? {}) };
  if (isWordmark(logo.onDark) || isWordmark(logo.onLight) || prev.name !== b.name.trim()) {
    wordmark(dir, b.name.trim(), b.base.ink);
    if (isWordmark(logo.onDark)) logo.onDark = "assets/wordmark-dark.svg";
    if (isWordmark(logo.onLight)) logo.onLight = "assets/wordmark-light.svg";
  }
  const kit = {
    id, name: b.name.trim(), theme: b.theme ?? prev.theme, base: b.base, colors: deriveColors(b.base), fonts, logo,
    voice: { provider: "kokoro", voice: b.voice?.voice ?? prev.voice?.voice ?? "af_heart", speed: b.voice?.speed ?? prev.voice?.speed ?? 0.94 },
    pronunciations: b.pronunciations ?? prev.pronunciations ?? {},
    music: { preset: b.music ?? prev.music?.preset ?? "uplifting-tech" },
    ...((b.ctaUrl ?? prev.cta?.url) ? { cta: { url: b.ctaUrl ?? prev.cta.url } } : {}),
  };
  if (b.ctaUrl === "") delete (kit as { cta?: unknown }).cta;
  const r = BrandKit.safeParse(kit);
  if (!r.success) throw new StudioError(422, "invalid brand", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  fs.writeFileSync(path.join(dir, "brand.json"), JSON.stringify(kit, null, 2) + "\n");
  return kit;
}

/** A theme as a BrandInput, keeping the identity (name, website, pronunciations) of an existing brand. */
export function themeInput(themeId: string, name: string, keep: Partial<BrandInput> = {}): BrandInput {
  const t = getTheme(themeId);
  return { ...keep, name, theme: t.id, base: t.base, music: keep.music ?? t.music, voice: keep.voice ?? t.voice,
    fonts: { display: { library: t.fonts.display }, body: { library: t.fonts.body }, mono: { library: t.fonts.mono } } };
}

/** Materialise a theme as a brand folder (template thumbnails, CLI). */
export function materializeTheme(dir: string, id: string, themeId: string, name: string) { return writeBrand(dir, id, themeInput(themeId, name)); }

/* ---------- a project's brand ---------- */

const bdir = (project: string) => {
  const d = path.join(pdir(project), "brand");
  if (!fs.existsSync(path.join(d, "brand.json"))) throw new StudioError(404, `project "${project}" has no brand yet`);
  return d;
};
export const projectBrandDir = (project: string) => path.join(pdir(project), "brand");

export function brandView(project: string) {
  const d = bdir(project);
  const kit = JSON.parse(fs.readFileSync(path.join(d, "brand.json"), "utf8"));
  const u = (f?: string) => (f && fs.existsSync(path.join(d, f)) ? `/brand/${project}/${f}?v=${Math.round(fs.statSync(path.join(d, f)).mtimeMs)}` : undefined);
  return { ...kit, id: project, project, wordmark: { onDark: isWordmark(kit.logo?.onDark), onLight: isWordmark(kit.logo?.onLight) },
    urls: { logoOnDark: u(kit.logo?.onDark), logoOnLight: u(kit.logo?.onLight), mark: u(kit.logo?.mark),
      fonts: Object.fromEntries(Object.entries(kit.fonts ?? {}).map(([r, f]: [string, any]) => [r, u(f.file)])) } };
}

export function saveProjectBrand(project: string, b: BrandInput) {
  writeBrand(projectBrandDir(project), project, b);
  syncSpecToBrand(project);
  return brandView(project);
}

/** Switch a project's look to a theme; keeps its name, logos, website and pronunciations. */
export function applyTheme(project: string, themeId: string) {
  const d = projectBrandDir(project);
  const prev = fs.existsSync(path.join(d, "brand.json")) ? JSON.parse(fs.readFileSync(path.join(d, "brand.json"), "utf8")) : {};
  const name = prev.name ?? JSON.parse(fs.readFileSync(path.join(pdir(project), "spec.json"), "utf8")).title;
  // theme fonts replace uploaded ones; theme music replaces the old default
  writeBrand(d, project, themeInput(themeId, name, { pronunciations: prev.pronunciations, ctaUrl: prev.cta?.url, voice: prev.voice }));
  syncSpecToBrand(project, { music: true });
  return brandView(project);
}

export type BrandFileKind = "logoOnDark" | "logoOnLight" | "logo" | "mark" | "fontDisplay" | "fontBody" | "fontMono";
/** Upload a logo or font into a project's brand. "logo" sets both logos (one file for dark and light). */
export function saveBrandFile(project: string, kind: BrandFileKind, filename: string, data: Buffer) {
  const d = bdir(project);
  const ext = path.extname(filename).toLowerCase();
  const isFont = kind.startsWith("font");
  if (isFont && ![".ttf", ".otf", ".woff2", ".woff"].includes(ext)) throw new StudioError(400, "fonts: .ttf, .otf, .woff2 or .woff");
  if (!isFont && ![".png", ".svg", ".webp", ".jpg", ".jpeg"].includes(ext)) throw new StudioError(400, "logos: .png, .svg, .webp or .jpg");
  if (ext === ".svg" && /<script|on\w+=|javascript:/i.test(data.toString("utf8"))) throw new StudioError(400, "SVG contains scripts; export it again without them");
  const sub = isFont ? "fonts" : "assets";
  const name = `${kind}${ext}`;
  fs.mkdirSync(path.join(d, sub), { recursive: true });
  for (const f of fs.readdirSync(path.join(d, sub))) if (f.startsWith(`${kind}.`)) fs.rmSync(path.join(d, sub, f));
  fs.writeFileSync(path.join(d, sub, name), data);
  const kit = JSON.parse(fs.readFileSync(path.join(d, "brand.json"), "utf8"));
  const rel = `${sub}/${name}`;
  if (kind === "logo") { kit.logo.onDark = rel; kit.logo.onLight = rel; }
  if (kind === "logoOnDark") { kit.logo.onDark = rel; if (isWordmark(kit.logo.onLight)) kit.logo.onLight = rel; }
  if (kind === "logoOnLight") { kit.logo.onLight = rel; if (isWordmark(kit.logo.onDark)) kit.logo.onDark = rel; }
  if (kind === "mark") kit.logo.mark = rel;
  if (isFont) {
    const role = kind.slice(4).toLowerCase() as Role;
    kit.fonts[role] = { family: path.basename(filename, ext).replace(/[-_]?(Variable|VF|Regular)$/i, ""), file: rel, weight: "100 900" };
  }
  fs.writeFileSync(path.join(d, "brand.json"), JSON.stringify(kit, null, 2) + "\n");
  return brandView(project);
}

/** Remove an uploaded logo (back to the name wordmark). */
export function removeBrandLogo(project: string) {
  const d = bdir(project);
  const kit = JSON.parse(fs.readFileSync(path.join(d, "brand.json"), "utf8"));
  wordmark(d, kit.name, kit.base?.ink ?? kit.colors.ink);
  kit.logo = { onDark: "assets/wordmark-dark.svg", onLight: "assets/wordmark-light.svg" };
  fs.writeFileSync(path.join(d, "brand.json"), JSON.stringify(kit, null, 2) + "\n");
  return brandView(project);
}

/** Keep spec.brand pointing at the project's own brand; optionally adopt the brand's music. */
function syncSpecToBrand(project: string, o: { music?: boolean } = {}) {
  const f = path.join(pdir(project), "spec.json");
  const spec = JSON.parse(fs.readFileSync(f, "utf8"));
  const kit = JSON.parse(fs.readFileSync(path.join(projectBrandDir(project), "brand.json"), "utf8"));
  let changed = false;
  if (spec.brand !== project) { spec.brand = project; changed = true; }
  if (o.music && spec.music?.mode === "preset" && kit.music?.preset && spec.music.preset !== kit.music.preset) { spec.music = { mode: "preset", preset: kit.music.preset }; changed = true; }
  if (changed) fs.writeFileSync(f, JSON.stringify(spec, null, 2) + "\n");
}

/** Earlier studio versions shared brand kits between projects: give each such project its own copy. */
export function migrateProjectBrands() {
  const shared = [path.join(path.dirname(projectsDir()), "brands"), env.brandsDir(), path.join(REPO, "brands")];
  for (const id of fs.readdirSync(projectsDir())) {
    const d = path.join(projectsDir(), id);
    if (!fs.existsSync(path.join(d, "spec.json")) || fs.existsSync(path.join(d, "brand", "brand.json"))) continue;
    const spec = JSON.parse(fs.readFileSync(path.join(d, "spec.json"), "utf8"));
    const src = shared.map((s) => path.join(s, spec.brand ?? "")).find((s) => spec.brand && fs.existsSync(path.join(s, "brand.json")));
    if (src) {
      fs.cpSync(src, path.join(d, "brand"), { recursive: true });
      const kit = JSON.parse(fs.readFileSync(path.join(d, "brand", "brand.json"), "utf8"));
      kit.id = id;
      fs.writeFileSync(path.join(d, "brand", "brand.json"), JSON.stringify(kit, null, 2) + "\n");
    } else writeBrand(path.join(d, "brand"), id, themeInput("classic", spec.title ?? id));
    spec.brand = id;
    fs.writeFileSync(path.join(d, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
  }
}

/** Synthesize a test line with a voice + pronunciation dictionary; returns a WAV path. */
export async function testVoice(o: { text: string; voice?: string; speed?: number; pronunciations?: Record<string, unknown>; project?: string }) {
  let dict = o.pronunciations;
  if (!dict && o.project) dict = JSON.parse(fs.readFileSync(path.join(bdir(o.project), "brand.json"), "utf8")).pronunciations ?? {};
  const r = await vsaudio<{ lines: { wav: string; dur: number; phonemes: string }[] }>("tts", {
    cacheDir: path.join(cacheDir(), "vo"), modelsDir: env.modelsDir(), voice: o.voice ?? "af_heart", speed: o.speed ?? 0.94, lang: "en-us",
    dictionary: dict ?? {}, lines: [{ id: "t", text: o.text.slice(0, 300), phonemes: null }],
  });
  return r.lines[0];
}
