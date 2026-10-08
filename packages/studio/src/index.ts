/*
 * Studio core: projects on the local filesystem, used by the web studio (apps/server) and the
 * Claude MCP server (apps/mcp). One project = a folder with spec.json, assets/ and revisions/.
 * M2 proper moves this behind Postgres + S3 with the same operations.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { MUSIC_CUES, SCENE_DEFS, TONES, TRANSITIONS, ASPECTS, migrate, validateSpec, type Issue } from "@vs/spec";
import {
  QUALITY, REPO, analyze, deliverables, env, prepare, render, serve, slug, stills, type DeliverableSet, type Quality, type Served,
} from "@vs/render";
import type { LintIssue, RuntimeDoc } from "@vs/runtime";

export const studioHome = () => process.env.VS_STUDIO_HOME ?? path.join(REPO, "studio-data");
const projectsDir = () => { const d = path.join(studioHome(), "projects"); fs.mkdirSync(d, { recursive: true }); return d; };
export const cacheDir = () => process.env.VS_CACHE ?? path.join(REPO, ".vs-cache");
const pdir = (id: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new StudioError(400, "bad project id");
  const d = path.join(projectsDir(), id);
  if (!fs.existsSync(path.join(d, "spec.json"))) throw new StudioError(404, `no project "${id}"`);
  return d;
};
export class StudioError extends Error { constructor(readonly status: number, msg: string, readonly issues?: Issue[]) { super(msg); } }

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
    const readme = fs.existsSync(path.join(dir, id, "README.md")) ? fs.readFileSync(path.join(dir, id, "README.md"), "utf8") : "";
    const desc = readme.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
    return { id, title: spec.title as string, description: desc, scenes: (spec.scenes as unknown[]).length, variants: spec.variants };
  });
}

export function listBrands() {
  const dir = env.brandsDir();
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "brand.json"))).map((id) => {
    const k = JSON.parse(fs.readFileSync(path.join(dir, id, "brand.json"), "utf8"));
    return { id, name: k.name as string, primary: k.colors?.primary as string, logo: `/brand/${id}/${k.logo?.onLight}` };
  });
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

export interface ProjectSummary { id: string; title: string; brand: string; updated: number; scenes: number; thumbnail?: string; renders: string[] }

export function listProjects(): ProjectSummary[] {
  return fs.readdirSync(projectsDir()).filter((id) => fs.existsSync(path.join(projectsDir(), id, "spec.json"))).map((id) => {
    const d = path.join(projectsDir(), id);
    const spec = JSON.parse(fs.readFileSync(path.join(d, "spec.json"), "utf8"));
    const out = path.join(d, "out");
    const renders = fs.existsSync(out) ? fs.readdirSync(out).filter((v) => v !== "stills" && fs.statSync(path.join(out, v)).isDirectory()) : [];
    const thumb = fs.existsSync(path.join(out, "stills")) ? fs.readdirSync(path.join(out, "stills")).find((f) => f.endsWith("-sheet.jpg")) : undefined;
    return { id, title: spec.title, brand: spec.brand, updated: fs.statSync(path.join(d, "spec.json")).mtimeMs, scenes: spec.scenes?.length ?? 0,
      thumbnail: thumb ? `/files/${id}/out/stills/${thumb}` : undefined, renders };
  }).sort((a, b) => b.updated - a.updated);
}

export function createProject(o: { title: string; template?: string; brand?: string }): { id: string } {
  const template = o.template ?? "feature-launch";
  const src = path.join(REPO, "templates", template);
  if (!fs.existsSync(path.join(src, "spec.json"))) throw new StudioError(400, `unknown template "${template}"`);
  const brand = o.brand ?? "luraplus";
  if (!fs.existsSync(path.join(env.brandsDir(), brand, "brand.json"))) throw new StudioError(400, `unknown brand "${brand}"`);
  let id = slug(o.title || "video").toLowerCase().replace(/_/g, "-").slice(0, 40) || "video";
  if (!/^[a-z0-9]/.test(id)) id = "v-" + id;
  for (let n = 2; fs.existsSync(path.join(projectsDir(), id)); n++) id = id.replace(/-\d+$/, "") + "-" + n;
  const dst = path.join(projectsDir(), id);
  fs.cpSync(src, dst, { recursive: true, filter: (f) => !f.includes(`${path.sep}_source`) && !f.endsWith("README.md") });
  const spec = JSON.parse(fs.readFileSync(path.join(dst, "spec.json"), "utf8"));
  spec.title = o.title || spec.title;
  spec.brand = brand;
  delete spec.$schema;
  fs.writeFileSync(path.join(dst, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
  return { id };
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
  runtimeServer ??= serve({ brandsDir: env.brandsDir(), assetsDir: path.join(cacheDir(), "assets") });
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
  return { variants: p.project.spec.variants.map((x) => x.id), variant: v, doc, lint: an.lint, duration: doc.duration,
    scenes: resolved.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, vo: s.vo.map((x) => ({ id: x.id, t: x.t, dur: x.dur })) })),
    warnings: resolved.warnings, dropped: resolved.dropped };
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
  return fs.readdirSync(out).filter((v) => v !== "stills" && fs.statSync(path.join(out, v)).isDirectory()).map((v) => ({
    variant: v,
    files: fs.readdirSync(path.join(out, v)).filter((f) => !f.startsWith(".") && !/^(mix|stem_.*)\.wav$/.test(f) && !f.endsWith(".json")).sort()
      .map((f) => ({ name: f, path: `out/${v}/${f}`, bytes: fs.statSync(path.join(out, v, f)).size })),
  }));
}
