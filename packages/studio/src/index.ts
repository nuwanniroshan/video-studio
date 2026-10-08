/*
 * Studio core: projects on the local filesystem, used by the web studio (apps/server) and the
 * Claude MCP server (apps/mcp). One project = a folder with spec.json, assets/ and revisions/.
 * M2 proper moves this behind Postgres + S3 with the same operations.
 */
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { MUSIC_CUES, SCENE_DEFS, TONES, TRANSITIONS, ASPECTS, migrate, validateSpec, type Issue } from "@vs/spec";
import {
  QUALITY, REPO, analyze, deliverables, env, prepare, render, serve, slug, stills, type DeliverableSet, type Quality, type Served,
} from "@vs/render";
import type { LintIssue, RuntimeDoc } from "@vs/runtime";

import { StudioError, cacheDir, pdir, projectsDir, studioHome, validId } from "./errors.ts";
import { migrateProjectBrands, themeInput, writeBrand, type BrandInput } from "./brands.ts";
export { StudioError, cacheDir, studioHome };
export * from "./brands.ts";
export * from "./brief.ts";
export * from "./idea.ts";
import { briefToSpec, type Brief } from "./brief.ts";
import { ideaToBrief, type IdeaInput } from "./idea.ts";
import { mixAudio } from "@vs/render";

/** Call once at startup (server, MCP): gives projects from older versions their own brand. */
export function initStudio() { migrateProjectBrands(); }

/* ---------- catalog ---------- */

export const VOICES = [
  { id: "af_heart", label: "Heart (US female, warm)" }, { id: "af_bella", label: "Bella (US female, bright)" },
  { id: "af_nicole", label: "Nicole (US female, soft)" }, { id: "af_sarah", label: "Sarah (US female)" },
  { id: "am_michael", label: "Michael (US male)" }, { id: "am_adam", label: "Adam (US male, deep)" },
  { id: "am_fenrir", label: "Fenrir (US male, energetic)" }, { id: "bf_emma", label: "Emma (UK female)" },
  { id: "bf_isabella", label: "Isabella (UK female)" }, { id: "bm_george", label: "George (UK male)" },
];

export function listTemplates() {
  const dir = path.join(REPO, "templates");
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "spec.json"))).map((id) => {
    const spec = JSON.parse(fs.readFileSync(path.join(dir, id, "spec.json"), "utf8"));
    const meta = fs.existsSync(path.join(dir, id, "template.json")) ? JSON.parse(fs.readFileSync(path.join(dir, id, "template.json"), "utf8")) : {};
    return { id, name: meta.name ?? id, theme: meta.theme as string | undefined, product: meta.product as string | undefined, order: meta.order ?? 99, category: meta.category ?? "", description: meta.description ?? "", length: meta.length ?? "",
      formats: meta.formats ?? spec.variants.map((v: { aspect: string }) => v.aspect), scenes: (spec.scenes as { type: string }[]).map((s) => s.type),
      thumbnail: fs.existsSync(path.join(dir, id, "thumb.jpg")) ? `/api/templates/${id}/thumb.jpg` : undefined, variants: spec.variants };
  }).sort((a, b) => a.order - b.order);
}
export const templateThumb = (id: string) => {
  const f = path.join(REPO, "templates", path.basename(id), "thumb.jpg");
  if (!fs.existsSync(f)) throw new StudioError(404, "no thumbnail");
  return f;
};

/** A theme that suits the subject, by keyword (no AI). */
export function guessTheme(text: string): string {
  const t = text.toLowerCase();
  // whole words; a trailing * allows any ending (bake* = bakery, baker, baked…)
  const rules: [string, string][] = [
    ["coffee* cafe* barista* bake* restaurant* bistro* wine* chocolat* tea teas artisan* craft* boutique* bookshop* bookstore* interior* furniture*", "editorial"],
    ["health* clinic* doctor* dental dentist* therap* care wellness yoga medit* pharma* nurse*", "care"],
    ["garden* plant* eco green* sustainab* organic farm* outdoor* hike* hiking nature solar", "evergreen"],
    ["bank* financ* insur* accounting accountant* invoic* payroll legal law lawyer* tax taxes invest* loan*", "trust"],
    ["sale sales discount* offer* deal deals fashion beauty party festival* music concert* game games gaming", "pop"],
    ["travel* beach* surf* swim* pool boat* airline* holiday* ocean* sea", "ocean"],
    ["food* pizza* burger* juice* smoothie* kids family fitness gym* sport* running", "citrus"],
    ["luxury jewel* watch watches hotel* spa premium property properties", "royal"],
    ["ai developer* api apis cloud security cyber* data devops saas platform*", "midnight"],
  ];
  const re = (words: string) => new RegExp(`\\b(${words.split(" ").map((w) => w.endsWith("*") ? `${w.slice(0, -1)}\\w*` : w).join("|")})\\b`, "u");
  return rules.find(([w]) => re(w).test(t))?.[1] ?? "classic";
}

export function listPresets() {
  const d = path.join(REPO, "python/vsaudio/score/presets");
  return fs.readdirSync(d).filter((f) => f.endsWith(".yaml")).map((f) => f.replace(/\.yaml$/, ""));
}

export function catalog() {
  return {
    scenes: SCENE_DEFS.map((d) => ({ type: d.type, version: d.version, meta: d.meta, example: d.example,
      schema: z.toJSONSchema(d.schema, { io: "input", unrepresentable: "any" }) })),
    tones: TONES, transitions: TRANSITIONS, musicCues: MUSIC_CUES, aspects: ASPECTS,
    voices: VOICES, presets: listPresets(), qualities: Object.keys(QUALITY),
  };
}

/* ---------- projects ---------- */

export interface ProjectSummary { id: string; title: string; brand: { name: string; primary: string; theme?: string }; updated: number; scenes: number; thumbnail?: string; renders: string[]; agent?: string }

export function listProjects(): ProjectSummary[] {
  return fs.readdirSync(projectsDir()).filter((id) => fs.existsSync(path.join(projectsDir(), id, "spec.json"))).map((id) => {
    const d = path.join(projectsDir(), id);
    const spec = JSON.parse(fs.readFileSync(path.join(d, "spec.json"), "utf8"));
    const out = path.join(d, "out");
    const renders = fs.existsSync(out) ? fs.readdirSync(out).filter((v) => v !== "stills" && !v.startsWith(".") && fs.statSync(path.join(out, v)).isDirectory()) : [];
    // poster: a frame of the latest render, else the preview thumbnail, else the contact sheet
    const own = path.join(out, ".thumb.jpg");
    if (renders.length && (!fs.existsSync(own) || fs.statSync(own).mtimeMs < newestRender(out, renders))) {
      const mp4 = renders.map((v) => fs.readdirSync(path.join(out, v)).filter((f) => /\.mp4$/.test(f) && !f.startsWith(".")).map((f) => path.join(out, v, f))).flat()[0];
      if (mp4) spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(1, probeDuration(mp4) * 0.42)), "-i", mp4, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", own]);
    }
    const sheet = fs.existsSync(path.join(out, "stills")) ? fs.readdirSync(path.join(out, "stills")).find((f) => f.endsWith("-sheet.jpg")) : undefined;
    const thumb = fs.existsSync(own) ? `/files/${id}/out/.thumb.jpg?v=${Math.round(fs.statSync(own).mtimeMs)}` : sheet ? `/files/${id}/out/stills/${sheet}` : undefined;
    const kit = fs.existsSync(path.join(d, "brand", "brand.json")) ? JSON.parse(fs.readFileSync(path.join(d, "brand", "brand.json"), "utf8")) : {};
    return { id, title: spec.title, brand: { name: kit.name ?? spec.brand, primary: kit.colors?.primary ?? "#888888", theme: kit.theme }, updated: fs.statSync(path.join(d, "spec.json")).mtimeMs, scenes: spec.scenes?.length ?? 0, thumbnail: thumb, renders };
  }).sort((a, b) => b.updated - a.updated);
}

const ASPECT_ID: Record<string, string> = { "16:9": "landscape", "9:16": "vertical", "1:1": "square", "4:5": "feed" };
/** Keep the template's variants for chosen aspects, add plain ones for the rest; the first stays "main"-like. */
function applyFormats(spec: any, formats?: string[]) {
  if (!formats?.length) return;
  const keep = spec.variants.filter((v: any) => formats.includes(v.aspect));
  for (const a of formats) if (!keep.some((v: any) => v.aspect === a))
    keep.push({ id: ASPECT_ID[a], aspect: a, safeArea: a === "9:16" ? "reels" : "title", ...(a !== "16:9" ? { loudness: -14 } : {}) });
  keep.sort((x: any, y: any) => formats.indexOf(x.aspect) - formats.indexOf(y.aspect));
  const seen = new Set<string>();
  spec.variants = keep.map((v: any) => { let id = v.id; for (let n = 2; seen.has(id); n++) id = `${v.id}-${n}`; seen.add(id); return { ...v, id }; });
}

function newProjectDir(title: string) {
  let id = slug(title || "video").toLowerCase().replace(/_/g, "-").slice(0, 40) || "video";
  if (!/^[a-z0-9]/.test(id)) id = "v-" + id;
  for (let n = 2; fs.existsSync(path.join(projectsDir(), id)); n++) id = id.replace(/-\d+$/, "") + "-" + n;
  return { id, dir: path.join(projectsDir(), id) };
}

/** Temporary uploads (e.g. screenshots in the idea form, before the project exists). */
export function saveUpload(filename: string, data: Buffer) {
  const ext = path.extname(filename).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new StudioError(400, "images only (png, jpg, webp)");
  const d = path.join(studioHome(), "uploads"); fs.mkdirSync(d, { recursive: true });
  const name = `${Date.now().toString(36)}-${path.basename(filename, ext).replace(/[^\w-]+/g, "-").slice(0, 30)}${ext}`;
  fs.writeFileSync(path.join(d, name), data);
  return `upload:${name}`;
}

export type BrandChoice = { theme: string; name?: string } | { custom: BrandInput };
export interface NewVideo extends Partial<IdeaInput> {
  title?: string;
  /** start from this template's storyboard (else a draft is written from the idea) */
  template?: string;
  /** the project's own brand: a theme, or the user's colours/fonts (logos are uploaded after) */
  brand?: BrandChoice;
  speed?: number;
  /** a guided brief instead of free text */
  brief?: Brief;
}

/** Copy an uploaded image (upload:<name>) or keep a project path. */
function takeUpload(dir: string, ref: string) {
  if (!ref.startsWith("upload:")) return ref;
  const src = path.join(studioHome(), "uploads", path.basename(ref.slice(7)));
  if (!fs.existsSync(src)) throw new StudioError(400, "an uploaded image expired; upload it again");
  const name = path.basename(src).replace(/^[a-z0-9]+-/, "");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.copyFileSync(src, path.join(dir, "assets", name));
  return `assets/${name}`;
}

/**
 * New project: its own brand (theme or custom), uploaded images, and a complete first storyboard:
 * the template's, or one written from the idea by rules (no AI). An agent can then rewrite it.
 */
export function createVideoProject(o: NewVideo): { id: string } {
  const tpl = o.template ? listTemplates().find((t) => t.id === o.template) : undefined;
  if (o.template && !tpl) throw new StudioError(400, `unknown template "${o.template}"`);
  if (!tpl && !o.brief && !o.idea?.trim()) throw new StudioError(400, "describe the video or pick a template");
  const brandName = ("custom" in (o.brand ?? {}) ? (o.brand as { custom: BrandInput }).custom.name : (o.brand as { name?: string } | undefined)?.name) || o.name || o.brief?.product;
  const title = o.title?.trim() || brandName || tpl?.name || (o.idea ?? "").split(/[.!?\n]/)[0].slice(0, 60) || "New video";
  const { id, dir } = newProjectDir(title);
  try {
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    // brand
    const choice = o.brand ?? { theme: tpl?.theme ?? "classic" };
    // "auto": the agent designs the look; until then (or without an agent) a theme guessed from the idea stands in
    const input = "custom" in choice ? choice.custom : themeInput(choice.theme === "auto" ? guessTheme(`${o.idea ?? ""} ${brandName ?? ""}`) : choice.theme, brandName || title);
    if (o.url) input.ctaUrl = o.url;
    if (o.voice) input.voice = { voice: o.voice, speed: o.speed ?? input.voice?.speed ?? 0.94 };
    if (o.music && o.music !== "none") input.music = o.music;
    const kit = writeBrand(path.join(dir, "brand"), id, input);
    const shots = (o.screenshots ?? []).map((r) => takeUpload(dir, r));
    // storyboard
    let spec: any;
    if (tpl) {
      const src = path.join(REPO, "templates", tpl.id);
      if (fs.existsSync(path.join(src, "assets"))) fs.cpSync(path.join(src, "assets"), path.join(dir, "assets"), { recursive: true });
      let text = fs.readFileSync(path.join(src, "spec.json"), "utf8");
      if (tpl.product && kit.name) text = text.split(tpl.product).join(kit.name.replace(/["\\]/g, ""));
      spec = JSON.parse(text);
      delete spec.$schema;
      spec.title = title;
      applyFormats(spec, o.formats);
    } else {
      const brief = o.brief ? { ...o.brief, screenshots: shots } : ideaToBrief({ ...(o as IdeaInput), name: brandName, screenshots: shots });
      spec = briefToSpec({ ...brief, product: brief.product || kit.name }, id);
      spec.title = title;
    }
    spec.brand = id;
    spec.voice = { provider: "kokoro", voice: kit.voice.voice, speed: kit.voice.speed };
    if (o.music === "none") spec.music = { mode: "none" };
    else spec.music = { ...(spec.music?.mode === "preset" ? spec.music : {}), mode: "preset", preset: kit.music.preset };
    if (kit.music.preset !== (spec.music.preset)) delete spec.music.bpm;
    fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "request.json"), JSON.stringify({ ...o, brand: choice, screenshots: shots, created: new Date().toISOString() }, null, 2) + "\n");
    const r = validateSpec(migrate(spec));
    if (!r.ok) throw new StudioError(422, "the first draft is invalid", r.issues);
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
  return { id };
}
/** The original request (idea, options) a project was created from. */
export function projectRequest(id: string): (NewVideo & { created?: string }) | null {
  const f = path.join(pdir(id), "request.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

function newestRender(out: string, renders: string[]) {
  return Math.max(0, ...renders.flatMap((v) => fs.readdirSync(path.join(out, v)).filter((f) => f.endsWith(".mp4")).map((f) => fs.statSync(path.join(out, v, f)).mtimeMs)));
}
function probeDuration(f: string) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" });
  return parseFloat(r.stdout) || 2;
}

/** A poster still for projects that haven't been rendered (from the first preview). Fire-and-forget. */
async function ensureThumb(id: string, doc: RuntimeDoc, t: number) {
  const d = pdir(id);
  const own = path.join(d, "out", ".thumb.jpg");
  if (fs.existsSync(own) && Date.now() - fs.statSync(own).mtimeMs < 60_000) return;
  try {
    const srv = await runtimeOrigin();
    const { openPage, seek } = await import("@vs/render");
    const { browser, page } = await openPage(srv.origin, doc, 1);
    await seek(page, t);
    fs.mkdirSync(path.dirname(own), { recursive: true });
    const tmp = own + ".png";
    await page.screenshot({ path: tmp });
    await browser.close();
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-vf", "scale=640:-2", "-q:v", "4", own]);
    fs.rmSync(tmp, { force: true });
  } catch { /* best effort */ }
}

/** New project from a template (kept for the CLI/MCP): same as createVideoProject({ template }). */
export function createProject(o: { title: string; template?: string; theme?: string; formats?: string[] }): { id: string } {
  const template = o.template ?? "feature-launch";
  return createVideoProject({ title: o.title, template, formats: o.formats, ...(o.theme ? { brand: { theme: o.theme } } : {}) });
}

export function getProject(id: string) {
  const d = pdir(id);
  const assets = fs.existsSync(path.join(d, "assets")) ? fs.readdirSync(path.join(d, "assets")).filter((f) => !f.startsWith(".")) : [];
  return { id, dir: d, spec: JSON.parse(fs.readFileSync(path.join(d, "spec.json"), "utf8")), assets: assets.map((a) => `assets/${a}`) };
}

/** Validate and save; every save keeps an immutable revision. Invalid specs are not saved. */
export function saveSpec(id: string, raw: unknown): { ok: boolean; issues: Issue[]; revision?: number } {
  const d = pdir(id);
  const r = validateSpec(migrate(raw));
  if (!r.ok) return { ok: false, issues: r.issues };
  const revs = path.join(d, "revisions");
  fs.mkdirSync(revs, { recursive: true });
  const n = fs.readdirSync(revs).length + 1;
  const text = JSON.stringify(raw, null, 2) + "\n";
  fs.writeFileSync(path.join(revs, `${String(n).padStart(4, "0")}.json`), text);
  fs.writeFileSync(path.join(d, "spec.json"), text);
  return { ok: true, issues: [], revision: n };
}

export function deleteProject(id: string) { fs.rmSync(pdir(id), { recursive: true, force: true }); }

export function saveAsset(id: string, filename: string, data: Buffer): string {
  const d = pdir(id);
  const ext = path.extname(filename).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new StudioError(400, "images only (png, jpg, webp)");
  const base = path.basename(filename, path.extname(filename)).replace(/[^\w-]+/g, "-").slice(0, 40) || "image";
  fs.mkdirSync(path.join(d, "assets"), { recursive: true });
  let name = `${base}${ext}`;
  for (let n = 2; fs.existsSync(path.join(d, "assets", name)); n++) name = `${base}-${n}${ext}`;
  fs.writeFileSync(path.join(d, "assets", name), data);
  return `assets/${name}`;
}

/** A project file (asset or output) by relative path, safely. */
export function projectFile(id: string, rel: string): string {
  const d = pdir(id);
  const f = path.resolve(d, rel);
  if (!f.startsWith(d + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) throw new StudioError(404, "not found");
  return f;
}

/* ---------- preview, stills, render ---------- */

let runtimeServer: Promise<Served> | null = null;
/** One localhost server for runtime, brands and content-addressed assets (all projects share the cache). */
export function runtimeOrigin(): Promise<Served> {
  runtimeServer ??= serve({ brandsDir: env.brandsDir(), assetsDir: path.join(cacheDir(), "assets"),
    brandDir: (id) => { const d = path.join(projectsDir(), id, "brand"); return validId(id) && fs.existsSync(path.join(d, "brand.json")) ? d : null; } });
  return runtimeServer;
}

export interface Preview { variants: string[]; variant: string; doc: RuntimeDoc; lint: LintIssue[]; duration: number;
  scenes: { id: string; start: number; end: number; vo: { id: string; t: number; dur: number }[] }[]; warnings: string[]; dropped: string[] }

export async function preview(id: string, variant?: string): Promise<Preview> {
  const d = pdir(id);
  const spec = JSON.parse(fs.readFileSync(path.join(d, "spec.json"), "utf8"));
  const v = variant ?? spec.variants?.[0]?.id ?? "main";
  const p = await prepare(path.join(d, "spec.json"), [v], { cacheDir: cacheDir() });
  const { doc, resolved } = p.variants[0];
  const srv = await runtimeOrigin();
  const an = await analyze(srv, doc);
  if (!fs.existsSync(path.join(d, "out", ".thumb.jpg")) || !listOutputs(id).length) {
    const s = resolved.scenes.find((x) => ["featureSpotlight", "screenFlow", "mediaBroll", "statsCounter"].includes(x.type)) ?? resolved.scenes[Math.min(1, resolved.scenes.length - 1)];
    void ensureThumb(id, doc, s.start + Math.min(3, (s.end - s.start) * 0.6));
  }
  return { variants: p.project.spec.variants.map((x) => x.id), variant: v, doc, lint: an.lint, duration: doc.duration,
    scenes: resolved.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, vo: s.vo.map((x) => ({ id: x.id, t: x.t, dur: x.dur })) })),
    warnings: resolved.warnings, dropped: resolved.dropped };
}

/** Draft audio for the preview player: the same mix the render uses (cached). Returns a project-relative path. */
export async function previewAudio(id: string, variant?: string) {
  const d = pdir(id);
  const spec = JSON.parse(fs.readFileSync(path.join(d, "spec.json"), "utf8"));
  const v = variant ?? spec.variants?.[0]?.id ?? "main";
  const p = await prepare(path.join(d, "spec.json"), [v], { cacheDir: cacheDir() });
  const an = await analyze(await runtimeOrigin(), p.variants[0].doc);
  const out = path.join(d, "out", ".preview", v);
  fs.mkdirSync(out, { recursive: true });
  const r = await mixAudio(p, v, p.variants[0].resolved, an, out);
  return { path: path.relative(d, r.mix), lufs: r.report.lufs };
}

export async function contactSheets(id: string, variant?: string) {
  const d = pdir(id);
  return stills({ specPath: path.join(d, "spec.json"), variant, outDir: path.join(d, "out", "stills"), cacheDir: cacheDir() });
}

export interface RenderJob {
  id: string; project: string; status: "queued" | "running" | "done" | "error"; quality: Quality; variants: string[];
  progress: number; message: string; log: string[]; outputs: { variant: string; files: string[] }[]; error?: string; started: number; finished?: number;
  events: EventEmitter;
}
const jobs = new Map<string, RenderJob>();
let running: Promise<unknown> = Promise.resolve();

export function getJob(id: string) { return jobs.get(id); }
export function listJobs(project?: string) { return [...jobs.values()].filter((j) => !project || j.project === project); }
export const publicJob = (j: RenderJob) => { const { events, ...rest } = j; void events; return { ...rest, log: rest.log.slice(-30) }; };

/** Queue a render; renders run one at a time (each already uses every CPU). */
export function startRender(id: string, o: { variants?: string[]; quality?: Quality; deliverables?: DeliverableSet[] | "none" } = {}): RenderJob {
  const d = pdir(id);
  const spec = JSON.parse(fs.readFileSync(path.join(d, "spec.json"), "utf8"));
  const variants = o.variants?.length ? o.variants : spec.variants.map((v: { id: string }) => v.id);
  const job: RenderJob = { id: `${id}-${Date.now().toString(36)}`, project: id, status: "queued", quality: o.quality ?? spec.quality ?? "standard",
    variants, progress: 0, message: "Waiting…", log: [], outputs: [], started: Date.now(), events: new EventEmitter() };
  jobs.set(job.id, job);
  const emit = () => job.events.emit("update", publicJob(job));
  const log = (m: string) => { job.log.push(m); job.message = m.trim(); emit(); };
  running = running.then(async () => {
    job.status = "running";
    log("Preparing voice-over and timing…");
    try {
      const totals = new Map<string, number>();
      const { results, prepared } = await render({
        specPath: path.join(d, "spec.json"), variants, quality: job.quality, cacheDir: cacheDir(), outDir: path.join(d, "out"), log,
        onProgress: (p) => {
          totals.set(p.variant, p.done / Math.max(1, p.total));
          const vi = variants.indexOf(p.variant);
          job.progress = Math.min(0.9, ((vi + (totals.get(p.variant) ?? 0)) / variants.length) * 0.9);
          job.message = `Rendering ${p.variant}: ${p.done}/${p.total} frames`;
          emit();
        },
      });
      const sets = o.deliverables === "none" ? null : (o.deliverables ?? (["all"] as DeliverableSet[]));
      for (const r of results) {
        const v = prepared.variants.find((x) => x.id === r.variant)!;
        const base = `${slug(prepared.project.spec.title)}_${r.variant}`;
        let files = [r.file];
        if (sets) {
          log(`Encoding deliverables for ${r.variant}…`);
          files = [r.file, ...(await deliverables({ video: path.join(path.dirname(r.file), `.${base}_video.mp4`), mix: r.mix, stems: r.stems,
            resolved: v.resolved, outDir: path.dirname(r.file), base, fps: v.doc.fps }, sets, log))];
        }
        job.outputs.push({ variant: r.variant, files: files.map((f) => path.relative(d, f)) });
      }
      job.status = "done"; job.progress = 1; job.message = "Done";
    } catch (e) {
      job.status = "error"; job.error = (e as Error).message; job.message = "Failed: " + job.error;
    }
    job.finished = Date.now();
    emit();
  });
  return job;
}

/** Files already rendered for a project (by variant). */
export function listOutputs(id: string) {
  const d = pdir(id);
  const out = path.join(d, "out");
  if (!fs.existsSync(out)) return [];
  return fs.readdirSync(out).filter((v) => v !== "stills" && !v.startsWith(".") && fs.statSync(path.join(out, v)).isDirectory()).map((v) => ({
    variant: v,
    files: fs.readdirSync(path.join(out, v)).filter((f) => !f.startsWith(".") && !/^(mix|stem_.*)\.wav$/.test(f) && !f.endsWith(".json")).sort()
      .map((f) => ({ name: f, path: `out/${v}/${f}`, bytes: fs.statSync(path.join(out, v, f)).size })),
  }));
}
export * from "./agent.ts";
