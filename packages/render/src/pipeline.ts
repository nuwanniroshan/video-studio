/*
 * `vs render` pipeline (PLAN §10): resolve → analyze → audio ∥ segments (cached) → assemble.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { effectiveScenes, maxCharsIssues } from "@vs/spec";
import type { ResolvedTimeline } from "@vs/timing";
import type { LintIssue, LoadResult, RuntimeDoc } from "@vs/runtime";
import { buildDoc, runtimeHash } from "./doc.ts";
import { probe, run } from "./ffmpeg.ts";
import { openPage, seek } from "./page.ts";
import { loadProject, resolveVariant, synthVoices, voFor, type Project, type VoInfo } from "./project.ts";
import { QUALITY, type Quality } from "./quality.ts";
import { planSegments, type Segment } from "./segments.ts";
import { renderSegments } from "./segrender.ts";
import { serve, type Served } from "./server.ts";
import { vsaudio } from "./vsaudio.ts";

export interface Prepared { project: Project; vo: Map<string, VoInfo>; variants: { id: string; resolved: ResolvedTimeline; doc: RuntimeDoc }[] }

export async function prepare(specPath: string, variantIds?: string[], o: { cacheDir?: string; brandsDir?: string } = {}): Promise<Prepared> {
  const project = loadProject(specPath, o);
  const ids = variantIds?.length ? variantIds : project.spec.variants.map((v) => v.id);
  for (const id of ids) if (!project.spec.variants.some((v) => v.id === id)) throw new Error(`unknown variant "${id}"`);
  const vo = await synthVoices(project, ids);
  const variants = ids.map((id) => {
    const resolved = resolveVariant(project, id, vo);
    return { id, resolved, doc: buildDoc(project, resolved) };
  });
  return { project, vo, variants };
}

export const serveProject = (p: Project) => serve({ brandsDir: path.dirname(p.brandDir), assetsDir: p.store.dir("assets") });

/** Analyze pass: one headless page collects SFX markers and layout lint (incl. maxChars). */
export async function analyze(srv: Served, doc: RuntimeDoc): Promise<LoadResult> {
  const { browser, load } = await openPage(srv.origin, doc, 1);
  await browser.close();
  const lint: LintIssue[] = [...load.lint];
  for (const s of doc.scenes) for (const m of maxCharsIssues(s.type, s.props))
    lint.push({ level: "warning", scene: s.id, code: "max-chars", message: `${m.path}: ${m.length} characters (max ${m.maxChars})` });
  return { ...load, lint };
}

export interface RenderOptions {
  specPath: string; variants?: string[]; quality?: Quality; workers?: number; outDir?: string; cacheDir?: string;
  allowWarnings?: boolean; log?(msg: string): void; onProgress?(p: { variant: string; done: number; total: number }): void;
}
export interface VariantResult {
  variant: string; file: string; mix: string; stems: Record<string, string>; duration: number; frames: number;
  segments: { total: number; hits: number; rendered: number }; seconds: { analyze: number; audio: number; segments: number; assemble: number; total: number };
  lint: LintIssue[]; audio: Record<string, unknown>; captures: number; deduped: number;
}

export async function render(o: RenderOptions): Promise<{ results: VariantResult[]; prepared: Prepared }> {
  const log = o.log ?? (() => {});
  const T = Date.now();
  const prep = await prepare(o.specPath, o.variants, { cacheDir: o.cacheDir });
  const { project } = prep;
  const q = QUALITY[o.quality ?? project.spec.quality];
  const outRoot = o.outDir ?? path.join(project.specDir, "out");
  const srv = await serveProject(project);
  const results: VariantResult[] = [];
  try {
    for (const v of prep.variants) {
      const t0 = Date.now();
      const sec = { analyze: 0, audio: 0, segments: 0, assemble: 0, total: 0 };
      const outDir = path.join(outRoot, v.id);
      fs.mkdirSync(outDir, { recursive: true });
      // 1) analyze
      const an = await analyze(srv, v.doc);
      sec.analyze = (Date.now() - t0) / 1000;
      for (const l of an.lint) log(`  lint ${l.level} [${l.scene}] ${l.code}: ${l.message}`);
      const errors = an.lint.filter((l) => l.level === "error");
      if (errors.length) throw new Error(`${errors.length} lint error(s) in variant "${v.id}"; render refused`);
      // 2) audio (in parallel with segments)
      const ta = Date.now();
      const audioP = mixAudio(prep, v.id, v.resolved, an, outDir).then((r) => { sec.audio = (Date.now() - ta) / 1000; return r; });
      // 3) segments
      const ts = Date.now();
      const segs = planSegments(v.doc, q, { runtime: runtimeHash(), brand: project.brandHash });
      const misses = segs.filter((s) => !project.store.has("seg", `${s.key}.mp4`));
      const total = misses.reduce((a, s) => a + s.f1 - s.f0, 0);
      log(`  ${v.id}: ${segs.length} segments, ${segs.length - misses.length} cached, rendering ${misses.length} (${total} frames @ ${q.fps} fps)`);
      let done = 0;
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-seg-"));
      const r = misses.length
        ? await renderSegments({ origin: srv.origin, doc: v.doc, q, segments: misses, store: project.store, workers: o.workers ?? Math.max(1, os.availableParallelism() - 1), tmpDir: tmp,
            onFrame: () => { done++; if (done % 30 === 0 || done === total) o.onProgress?.({ variant: v.id, done, total }); } })
        : { captures: 0, deduped: 0 };
      fs.rmSync(tmp, { recursive: true, force: true });
      sec.segments = (Date.now() - ts) / 1000;
      const audio = await audioP;
      // 4) assemble: concat by stream copy, then mux the mix
      const tm = Date.now();
      const base = `${slug(project.spec.title)}_${v.id}`;
      const list = path.join(outDir, ".segments.txt");
      fs.writeFileSync(list, segs.map((s) => `file '${project.store.path("seg", `${s.key}.mp4`)}'`).join("\n"));
      const silent = path.join(outDir, `.${base}_video.mp4`);
      await run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);
      const file = path.join(outDir, `${base}.mp4`);
      await run(["-i", silent, "-i", audio.mix, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", file]);
      const frames = +(await probe(silent, ["-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0"]));
      const want = Math.round(v.doc.duration * q.fps);
      if (frames !== want) throw new Error(`assembled ${frames} frames, expected ${want}`);
      fs.writeFileSync(path.join(outDir, `${base}.timeline.json`), JSON.stringify(v.resolved, null, 1));
      sec.assemble = (Date.now() - tm) / 1000;
      sec.total = (Date.now() - t0) / 1000;
      results.push({ variant: v.id, file, mix: audio.mix, stems: audio.stems, duration: v.doc.duration, frames, lint: an.lint, audio: audio.report,
        segments: { total: segs.length, hits: segs.length - misses.length, rendered: misses.length }, seconds: sec, captures: r.captures, deduped: r.deduped });
      log(`  ${v.id}: wrote ${file} in ${sec.total.toFixed(1)} s`);
    }
  } finally {
    await srv.close();
  }
  log(`total ${((Date.now() - T) / 1000).toFixed(1)} s`);
  return { results, prepared: prep };
}

async function mixAudio(prep: Prepared, variant: string, r: ResolvedTimeline, an: LoadResult, outDir: string) {
  const { spec } = prep.project;
  const v = spec.variants.find((x) => x.id === variant)!;
  const eff = new Map(effectiveScenes(spec, variant).map((s) => [s.id, s]));
  const musicOn = spec.music.mode === "preset";
  const markers = an.markers
    // flash impacts are placed by the arranger when music is on
    .filter((m) => !(musicOn && m.kind === "impact" && (m.data as any)?.transition))
    .map((m) => ({ kind: m.kind, t: Math.round(m.t * 1e4) / 1e4, gain: (m.data as any)?.gain ?? 1, pan: (m.data as any)?.pan ?? 0 }));
  const vo = r.scenes.flatMap((s) => s.vo.map((x) => {
    const line = eff.get(s.id)!.vo.find((l) => l.id === x.id)!;
    return { id: `${s.id}.${x.id}`, t: x.t, wav: voFor(prep.vo, line.text, line.phonemes)!.wav };
  }));
  const stems = { music: path.join(outDir, "stem_music.wav"), sfx: path.join(outDir, "stem_sfx.wav"), vo: path.join(outDir, "stem_vo.wav") };
  const mix = path.join(outDir, "mix.wav");
  const report = await vsaudio<Record<string, unknown>>("mix", {
    duration: r.duration, seed: 1, loudness: v.loudness ?? -16,
    music: spec.music.mode === "preset" ? { mode: "preset", preset: spec.music.preset, ...(spec.music.bpm ? { bpm: spec.music.bpm } : { bpm: r.bpm }) } : { mode: "none" },
    scenes: r.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, musicCue: s.musicCue, transitionIn: s.transitionIn ? { type: s.transitionIn.type, start: s.transitionIn.start, end: s.transitionIn.end } : null })),
    markers, vo, out: { mix, stems },
  });
  fs.writeFileSync(path.join(outDir, "audio-report.json"), JSON.stringify(report, null, 1));
  return { mix, stems, report };
}

/** Stills at given times (seconds) for visual QA; optional contact sheet. */
export async function stills(o: { specPath: string; variant?: string; times?: number[]; every?: number; outDir: string; sheet?: boolean; cacheDir?: string }) {
  const prep = await prepare(o.specPath, o.variant ? [o.variant] : undefined, { cacheDir: o.cacheDir });
  const srv = await serveProject(prep.project);
  const out: { variant: string; files: string[]; sheet?: string; lint: LintIssue[] }[] = [];
  try {
    for (const v of prep.variants) {
      const an = await analyze(srv, v.doc);
      const times = o.times?.length ? o.times : cueTimes(v.resolved, o.every);
      const { browser, page } = await openPage(srv.origin, v.doc, 1);
      const dir = path.resolve(o.outDir, v.id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const files: string[] = [];
      let k = 0;
      for (const t of times) {
        await seek(page, t);
        const f = path.join(dir, `s-${String(k++).padStart(3, "0")}-${t.toFixed(2)}s.png`);
        await page.screenshot({ path: f });
        files.push(f);
      }
      await browser.close();
      let sheet: string | undefined;
      if (o.sheet !== false && files.length) sheet = await contactSheet(files, path.join(o.outDir, `${v.id}-sheet.jpg`), v.doc.width > v.doc.height ? 4 : 6);
      out.push({ variant: v.id, files, sheet, lint: an.lint });
    }
  } finally {
    await srv.close();
  }
  return out;
}

/** Default QA times: just after each scene settles and just before it leaves, plus every `every` seconds if given. */
export function cueTimes(r: ResolvedTimeline, every?: number): number[] {
  if (every) return Array.from({ length: Math.floor(r.duration / every) }, (_, i) => +(i * every + every / 2).toFixed(2));
  const ts: number[] = [];
  for (const s of r.scenes) {
    const a = (s.transitionIn?.end ?? s.start);
    ts.push(+(Math.min(s.end - 0.2, a + Math.max(1.6, (s.vo[0]?.t ?? a) - a + 1.4))).toFixed(2));
    ts.push(+(s.end - 0.7).toFixed(2));
  }
  return [...new Set(ts)].sort((a, b) => a - b);
}

export async function contactSheet(files: string[], out: string, cols: number): Promise<string> {
  const rows = Math.ceil(files.length / cols);
  const dir = path.dirname(files[0]);
  const list = path.join(dir, ".sheet.txt");
  fs.writeFileSync(list, files.map((f) => `file '${path.resolve(f)}'\nduration 1`).join("\n"));
  await run(["-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=${cols >= 6 ? 270 : 480}:-1,tile=${cols}x${rows}:padding=6:color=white`, "-frames:v", "1", "-q:v", "3", out]);
  fs.rmSync(list);
  return out;
}

export const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "video";
export type { Segment };
