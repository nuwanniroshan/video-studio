/*
 * Determinism (PLAN §14, amended after M0):
 *  1. segment: the same segments rendered by two workers with different prior history (and order)
 *     produce byte-identical frame hashes;
 *  2. cross-order: frames rendered in shuffled order across scenes differ by at most 1/255 per channel.
 * Uses the feature-launch template (TTS from cache). Run natively or in the render image.
 */
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUALITY, SHUTTER, buildDoc, capture, freshLoad, loadProject, openPage, openWorker, planSegments, runtimeHash, seek, serveProject, subTime } from "@vs/render";
import { resolve } from "@vs/timing";

/** Agreed bound after M0: 1/255 per channel (override with VS_CROSS_ORDER_MAX). */
const ALLOWED = +(process.env.VS_CROSS_ORDER_MAX ?? 1);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// synthetic VO durations (0.4 s/word): pixel determinism doesn't depend on TTS, and the render image has no Python
const project = loadProject(path.join(ROOT, "templates/feature-launch/spec.json"));
const doc = buildDoc(project, resolve(project.spec, "main", (_s, l) => 0.4 * l.text.split(/\s+/).length));
const prep = { project };
const q = QUALITY.standard;
const srv = await serveProject(prep.project);
const segs = planSegments(doc, q, { runtime: runtimeHash(), brand: prep.project.brandHash });
// one body and one transition from several scenes, trimmed to 20 frames each to keep it quick
const pick = [0, 3, 8, 14, 22, segs.length - 1].map((i) => segs[i]).map((s) => ({ ...s, f1: Math.min(s.f1, s.f0 + 20) }));

async function renderAll(order: typeof pick, warmup: typeof pick) {
  const w = await openWorker(srv.origin, doc, q.scale);
  const out = new Map<string, string>();
  try {
    for (const s of warmup) { await freshLoad(w, srv.origin, doc, s.scenes); for (let i = s.f0; i < s.f1; i += 3) { await seek(w.page, i / q.fps); await capture(w.cdp, "png"); } }
    for (const s of order) {
      await freshLoad(w, srv.origin, doc, s.scenes);
      for (let i = s.f0; i < s.f1; i++) for (let k = 0; k < q.sub; k++) {
        await w.page.evaluate((tt) => (window as any).__vs.seek(tt), Math.max(0, subTime(0, i, k, q.fps, q.sub, SHUTTER)));
        out.set(`${s.index}:${i}:${k}`, crypto.createHash("sha256").update(await capture(w.cdp, "png")).digest("hex"));
      }
    }
  } finally { await w.browser.close(); }
  return out;
}

const [A, B] = await Promise.all([renderAll(pick, []), renderAll([...pick].reverse(), [segs[5], segs[17], segs[9]])]);
const segMismatch = [...A.keys()].filter((k) => A.get(k) !== B.get(k));

// cross-order: same frames, sequential vs shuffled across scenes, full doc
const times = Array.from({ length: 24 }, (_, i) => +((i * doc.duration) / 24 + 0.37).toFixed(3));
const shuffled = [...times].sort((a, b) => Math.sin(a * 977) - Math.sin(b * 977));
async function shots(ts: number[]) {
  const { browser, page, cdp } = await openPage(srv.origin, doc, 1);
  const m = new Map<number, Buffer>();
  for (const t of ts) { await seek(page, t); m.set(t, await capture(cdp, "png")); }
  await browser.close();
  return m;
}
const [S1, S2] = await Promise.all([shots(times), shots(shuffled)]);
let maxDiff = 0, differing = 0;
for (const t of times) {
  const a = S1.get(t)!, b = S2.get(t)!;
  if (a.equals(b)) continue;
  differing++;
  // decode both PNGs to raw RGB with ffmpeg and take the max absolute channel difference
  const raw = (png: Buffer) => spawnSync("ffmpeg", ["-v", "error", "-f", "png_pipe", "-i", "-", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: png, maxBuffer: 64 << 20 }).stdout;
  const ra = raw(a), rb = raw(b);
  let fmax = 0, n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < ra.length; i++) {
    const d = Math.abs(ra[i] - rb[i]);
    if (!d) continue;
    n++; if (d > fmax) fmax = d;
    const px = Math.floor(i / 3), x = px % doc.width, y = Math.floor(px / doc.width);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  maxDiff = Math.max(maxDiff, fmax);
  const scene = doc.scenes.find((s) => t >= s.start && t < s.end)?.id;
  if (process.env.VS_DET_VERBOSE) console.log(`  t=${t} scene=${scene} max=${fmax} channels=${n} box=${x0},${y0}-${x1},${y1}`);
}
await srv.close();
const res = { segment: { frames: A.size, mismatches: segMismatch.length }, crossOrder: { frames: times.length, differing, maxDiff, allowed: ALLOWED } };
console.log(JSON.stringify(res));
process.exit(segMismatch.length || maxDiff > ALLOWED ? 1 : 0);
