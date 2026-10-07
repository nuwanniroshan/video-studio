/*
 * Segment rendering with a pool of browsers (one Chromium per worker). Every segment starts from a
 * freshly loaded page, which is what makes segments byte-identical across workers (SPIKE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import type { LoadResult, RuntimeDoc } from "@vs/runtime";
import type { LocalStore } from "@vs/storage";
import { CHROMIUM_ARGS, capture } from "./page.ts";
import { SHUTTER, subTime, type QualityTier } from "./quality.ts";
import { segmentEncoder } from "./ffmpeg.ts";
import type { Segment } from "./segments.ts";

export interface Worker { browser: Browser; page: Page; cdp: CDPSession }

export async function openWorker(origin: string, doc: RuntimeDoc, scale: number): Promise<Worker> {
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: { width: doc.width, height: doc.height }, deviceScaleFactor: scale });
  await page.route("**/*", (route) => {
    const u = route.request().url();
    return u.startsWith(origin + "/") || u.startsWith("data:") ? route.continue() : route.abort("blockedbyclient");
  });
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, cdp };
}

/** Fresh page state for a segment: navigate, then mount only the scenes it shows. */
export async function freshLoad(w: Worker, origin: string, doc: RuntimeDoc, only: string[]): Promise<LoadResult> {
  const errors: string[] = [];
  const onErr = (e: Error) => errors.push(e.message);
  w.page.on("pageerror", onErr);
  await w.page.goto(`${origin}/runtime/index.html`);
  await w.page.waitForFunction(() => (window as any).__vs !== undefined);
  const r = (await w.page.evaluate(([d, o]) => (window as any).__vs.load(d, { only: o }), [doc, only] as const)) as LoadResult;
  w.page.off("pageerror", onErr);
  if (errors.length) throw new Error("page error: " + errors.join("; "));
  return r;
}

/**
 * Post-pass (PLAN §7.4) is applied in ffmpeg, not the DOM, so frames stay dedupe-able. It runs in the
 * deliverable encodes (which re-encode anyway), not per segment: at the segments' CRF 8, grain made x264
 * the bottleneck (feature-launch segment time 168 s → 68 s without it) and the vignette alone cost ~30%.
 */
export const POST_FILTER = process.env.VS_POST ?? "";
/**
 * Finishing filter for deliverables. Grain is opt-in (VS_FINISH or `vs render --grain`): per-frame temporal
 * noise is nearly incompressible at master quality (45 s master: 768 MB with grain vs ~20 MB without).
 */
export const GRAIN = "noise=alls=3:allf=t:all_seed=7";
export const finishFilter = () => process.env.VS_FINISH ?? "vignette=angle=0.42";

export async function renderSegments(o: {
  origin: string; doc: RuntimeDoc; q: QualityTier; segments: Segment[]; store: LocalStore; workers: number; tmpDir: string;
  onFrame?(): void; onSegment?(s: Segment, sec: number): void; signal?: AbortSignal;
}): Promise<{ captures: number; deduped: number }> {
  const queue = [...o.segments];
  let captures = 0, deduped = 0;
  const n = Math.max(1, Math.min(o.workers, queue.length));
  const run = async () => {
    const w = await openWorker(o.origin, o.doc, o.q.scale);
    try {
      for (let seg = queue.shift(); seg; seg = queue.shift()) {
        const t0 = Date.now();
        await freshLoad(w, o.origin, o.doc, seg.scenes);
        const count = seg.f1 - seg.f0;
        const isStatic: boolean[] = await w.page.evaluate(
          ([a, k, fps, sub, sh]) => (window as any).__vs.staticFrames(a, k, fps, sub, sh), [seg.f0 / o.q.fps, count, o.q.fps, o.q.sub, SHUTTER] as const);
        const tmp = path.join(o.tmpDir, `${seg.key}.mp4`);
        const enc = segmentEncoder(tmp, { fps: o.q.fps, sub: o.q.sub, codec: o.q.capture === "png" ? "png" : "mjpeg", crf: o.q.crf, post: POST_FILTER || undefined });
        let last: Buffer | null = null;
        for (let i = seg.f0; i < seg.f1; i++) {
          if (o.signal?.aborted) throw new Error("cancelled");
          if (last && isStatic[i - seg.f0]) {
            for (let k = 0; k < o.q.sub; k++) await enc.write(last);
            deduped++;
          } else {
            for (let k = 0; k < o.q.sub; k++) {
              await w.page.evaluate((tt) => (window as any).__vs.seek(tt), Math.max(0, subTime(0, i, k, o.q.fps, o.q.sub)));
              last = await capture(w.cdp, o.q.capture, o.q.jpegQuality);
              captures++;
              await enc.write(last);
            }
          }
          o.onFrame?.();
        }
        await enc.end();
        o.store.commit("seg", `${seg.key}.mp4`, tmp);
        o.onSegment?.(seg, (Date.now() - t0) / 1000);
      }
    } finally {
      await w.browser.close();
    }
  };
  await Promise.all(Array.from({ length: n }, run));
  return { captures, deduped };
}

export function cleanTmp(dir: string) { fs.rmSync(dir, { recursive: true, force: true }); }
