/*
 * M0 spike harness.
 *   tsx spike.ts stills <out-dir> [aspect]
 *   tsx spike.ts clip <out.mp4> [quality] [workers] [aspect]
 *   tsx spike.ts bench <scene: title|plain|blur|3d|shadow> <quality> <workers> [seconds] [--no-dedupe]
 * bench prints one JSON line with the measured numbers.
 */
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { RuntimeDoc, RuntimeScene } from "@vs/runtime";
import crypto from "node:crypto";
import { capture, openPage, renderStills, renderVideo, seek, serve, type Quality } from "../src/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const brandsDir = path.join(ROOT, "brands");
const STAGES = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] } as const;

function doc(scenes: Omit<RuntimeScene, "vo" | "steps" | "cues">[], aspect: keyof typeof STAGES = "16:9", fps = 60): RuntimeDoc {
  const [w, h] = STAGES[aspect];
  return {
    aspect, width: w, height: h, fps, duration: scenes[scenes.length - 1].end,
    brandCss: "/brand/luraplus/brand.css", brandBase: "/brand/luraplus/",
    scenes: scenes.map((s) => ({ vo: [], steps: [], cues: {}, ...s })),
  };
}

const titleDoc = (aspect: keyof typeof STAGES = "16:9") => doc([
  { id: "hook", type: "kineticTitle", start: 0, end: 4, tone: "dark",
    props: { kicker: "Introducing", headline: "Meet *LuraPlus.*", sub: "HR, hiring and payroll in one place.", style: "rise" } },
  { id: "payoff", type: "kineticTitle", start: 4, end: 8, tone: "light",
    props: { kicker: "One platform", headline: "Run your entire business, *from one platform.*", style: "mask", align: "left" } },
], aspect);

const stressDoc = (mode: string, seconds: number) => doc([
  { id: "stress", type: "spikeStress", start: 0, end: seconds, tone: "light", props: { mode, cards: 12 } },
]);

const [cmd, ...a] = process.argv.slice(2);
if (cmd === "stills") {
  const aspect = (a[1] ?? "16:9") as keyof typeof STAGES;
  const r = await renderStills({ doc: titleDoc(aspect), brandsDir, times: [0.3, 0.7, 1.2, 2.0, 3.6, 4.4, 5.2, 7.0], outDir: a[0], prefix: aspect.replace(":", "x") });
  console.log(JSON.stringify({ files: r.files, lint: r.load.lint, warnings: r.load.warnings, markers: r.load.markers.length }, null, 1));
} else if (cmd === "clip") {
  const r = await renderVideo({ doc: titleDoc((a[3] ?? "16:9") as keyof typeof STAGES), brandsDir, quality: (a[1] ?? "cinema") as Quality, workers: +(a[2] ?? 6), out: a[0] });
  console.log(JSON.stringify({ ...r, load: { lint: r.load.lint } }));
} else if (cmd === "bench") {
  const [scene, quality, workers, seconds = "4"] = a;
  const d = scene === "title" ? titleDoc() : stressDoc(scene, +seconds);
  const to = scene === "title" ? Math.min(8, +seconds) : +seconds;
  const out = path.join(os.tmpdir(), `vs-bench-${process.pid}.mp4`);
  const r = await renderVideo({ doc: d, brandsDir, quality: quality as Quality, workers: +workers, to, out, dedupe: !a.includes("--no-dedupe") });
  console.log(JSON.stringify({ scene, quality, workers: +workers, cpus: os.availableParallelism(), frames: r.frames, seconds: +r.seconds.toFixed(2),
    outputFps: +r.outputFps.toFixed(2), capturesPerSec: +(r.captures / r.seconds).toFixed(2), deduped: r.deduped }));
} else if (cmd === "determinism") {
  // Same frames, two browsers, opposite/shuffled order: PNG bytes must match.
  const srv = await serve({ brandsDir });
  const d = titleDoc((a[0] ?? "16:9") as keyof typeof STAGES);
  const span = +(process.env.VS_DET_SPAN ?? 8);
  const times = Array.from({ length: 40 }, (_, i) => +(i * span / 40 + 0.0083).toFixed(4));
  const shuffled = a.includes("--same-order") ? times : [...times].sort((x, y) => Math.sin(x * 977) - Math.sin(y * 977));
  const hashes = async (ts: number[], tag: string) => {
    const { browser, page, cdp } = await openPage(srv.origin, d);
    const out = new Map<number, string>();
    for (const t of ts) { await seek(page, t); const buf = await capture(cdp, "png"); if (a.includes("--dump") && t === +(process.env.VS_DUMP_T ?? 2.0083)) (await import("node:fs")).writeFileSync(`out/dbg/det-${tag}.png`, buf); out.set(t, crypto.createHash("sha256").update(buf).digest("hex")); }
    await browser.close();
    return out;
  };
  const [A, B] = await Promise.all([hashes(times, "A"), hashes(shuffled, "B")]);
  const diff = times.filter((t) => A.get(t) !== B.get(t));
  await srv.close();
  console.log(JSON.stringify({ frames: times.length, mismatches: diff.length, at: diff }));
  if (diff.length) process.exitCode = 1;
} else if (cmd === "determinism-segment") {
  // A segment (frames in increasing order, as the renderer captures them) rendered on a freshly
  // loaded page must hash identically no matter what that worker rendered before.
  const srv = await serve({ brandsDir });
  const d = titleDoc((a[0] ?? "16:9") as keyof typeof STAGES);
  const seg = Array.from({ length: 60 }, (_, i) => +(3.0 + i / 60).toFixed(4)); // 3.0–4.0 s at 60 fps
  const junk = Array.from({ length: 30 }, (_, i) => +(7.9 - i * 0.13).toFixed(4));
  const { browser, page, cdp } = await openPage(srv.origin, d);
  const run = async () => { const o: string[] = []; for (const t of seg) { await seek(page, t); o.push(crypto.createHash("sha256").update(await capture(cdp, "png")).digest("hex")); } return o; };
  const reload = async () => { await page.reload(); await page.waitForFunction(() => (window as any).__vs !== undefined); await page.evaluate((x) => (window as any).__vs.load(x), d as any); };
  const A = await run();
  for (const t of junk) { await seek(page, t); await capture(cdp, "png"); }
  await reload();
  const B = await run();
  for (const t of junk) { await seek(page, t); await capture(cdp, "png"); }
  const C = await run(); // no reload: same page, different history
  await browser.close(); await srv.close();
  const mm = (x: string[]) => x.filter((h, i) => h !== A[i]).length;
  console.log(JSON.stringify({ frames: seg.length, afterReload: mm(B), withoutReload: mm(C) }));
} else {
  console.log("usage: spike.ts stills|clip|bench …");
}
