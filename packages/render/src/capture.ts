import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { RuntimeDoc, LoadResult } from "@vs/runtime";
import { capture, openPage, seek } from "./page.ts";
import { QUALITY, SHUTTER, subTime, type Quality, type QualityTier } from "./quality.ts";
import { concat, segmentEncoder } from "./ffmpeg.ts";
import { serve } from "./server.ts";

export interface RangeJob { i0: number; i1: number; out: string }
export interface Progress { framesDone: number; framesTotal: number; fps: number; etaSec: number }
export interface RenderOptions {
  doc: RuntimeDoc;
  brandsDir: string;
  assetsDir?: string;
  quality: Quality | QualityTier;
  workers?: number;
  from?: number;
  to?: number;
  out: string;
  workDir?: string;
  dedupe?: boolean;
  onProgress?(p: Progress): void;
  signal?: AbortSignal;
}
export interface RenderStats { frames: number; seconds: number; outputFps: number; captures: number; deduped: number; load: LoadResult }

/** Renders frames [i0, i1) of the timeline (at tier fps) into one segment file per job. */
export async function renderJobs(origin: string, doc: RuntimeDoc, q: QualityTier, t0: number, jobs: RangeJob[], o: {
  dedupe?: boolean; onFrame?(): void; signal?: AbortSignal;
}): Promise<{ captures: number; deduped: number; load: LoadResult }> {
  let captures = 0, deduped = 0;
  let load!: LoadResult;
  const runJob = async (job: RangeJob) => {
    const { browser, page, cdp, load: l } = await openPage(origin, doc, q.scale);
    load = l;
    try {
      const n = job.i1 - job.i0;
      const isStatic: boolean[] = o.dedupe === false ? [] : await page.evaluate(
        ([a, n, fps, sub, sh]) => (window as any).__vs.staticFrames(a, n, fps, sub, sh), [t0 + job.i0 / q.fps, n, q.fps, q.sub, SHUTTER] as const);
      const enc = segmentEncoder(job.out, { fps: q.fps, sub: q.sub, codec: q.capture === "png" ? "png" : "mjpeg", crf: q.crf });
      let last: Buffer | null = null;
      for (let i = job.i0; i < job.i1; i++) {
        if (o.signal?.aborted) throw new Error("cancelled");
        if (last && isStatic[i - job.i0]) {
          for (let k = 0; k < q.sub; k++) await enc.write(last);
          deduped++;
        } else {
          for (let k = 0; k < q.sub; k++) {
            await seek(page, Math.max(0, subTime(t0, i, k, q.fps, q.sub)));
            last = await capture(cdp, q.capture, q.jpegQuality);
            captures++;
            await enc.write(last);
          }
        }
        o.onFrame?.();
      }
      await enc.end();
    } finally {
      await browser.close();
    }
  };
  await Promise.all(jobs.map(runJob));
  return { captures, deduped, load };
}

/** Full render of [from, to): frames split evenly over workers, then concatenated by stream copy. */
export async function renderVideo(opt: RenderOptions): Promise<RenderStats> {
  const q = typeof opt.quality === "string" ? QUALITY[opt.quality] : opt.quality;
  const t0 = opt.from ?? 0, t1 = opt.to ?? opt.doc.duration;
  const n = Math.round((t1 - t0) * q.fps);
  const workers = Math.max(1, Math.min(opt.workers ?? Math.max(1, os.availableParallelism() - 1), n));
  const work = opt.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "vs-render-"));
  fs.mkdirSync(work, { recursive: true });
  const per = Math.ceil(n / workers);
  const jobs: RangeJob[] = [];
  for (let w = 0; w < workers; w++) {
    const i0 = w * per, i1 = Math.min(n, i0 + per);
    if (i0 < i1) jobs.push({ i0, i1, out: path.join(work, `seg-${String(w).padStart(3, "0")}.mp4`) });
  }
  const srv = await serve({ brandsDir: opt.brandsDir, assetsDir: opt.assetsDir });
  const started = Date.now();
  let done = 0;
  try {
    const r = await renderJobs(srv.origin, opt.doc, q, t0, jobs, {
      dedupe: opt.dedupe, signal: opt.signal,
      onFrame: () => {
        done++;
        if (opt.onProgress && (done % 30 === 0 || done === n)) {
          const el = (Date.now() - started) / 1000;
          opt.onProgress({ framesDone: done, framesTotal: n, fps: done / el, etaSec: (n - done) / (done / el) });
        }
      },
    });
    fs.mkdirSync(path.dirname(opt.out), { recursive: true });
    await concat(jobs.map((j) => j.out), path.join(work, "list.txt"), opt.out);
    const seconds = (Date.now() - started) / 1000;
    return { frames: n, seconds, outputFps: n / seconds, captures: r.captures, deduped: r.deduped, load: r.load };
  } finally {
    await srv.close();
  }
}

/** Render single frames (no motion blur) as PNGs, for visual QA. */
export async function renderStills(o: { doc: RuntimeDoc; brandsDir: string; assetsDir?: string; times: number[]; outDir: string; prefix?: string }): Promise<{ files: string[]; load: LoadResult }> {
  const srv = await serve({ brandsDir: o.brandsDir, assetsDir: o.assetsDir });
  const { browser, page, load } = await openPage(srv.origin, o.doc, 1);
  const files: string[] = [];
  try {
    fs.mkdirSync(o.outDir, { recursive: true });
    for (const t of o.times) {
      await seek(page, t);
      const f = path.join(o.outDir, `${o.prefix ?? "t"}-${t.toFixed(2)}.png`);
      await page.screenshot({ path: f });
      files.push(f);
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  return { files, load };
}
