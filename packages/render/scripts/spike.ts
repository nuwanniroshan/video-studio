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
import { renderStills, renderVideo, type Quality } from "../src/index.ts";

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
} else {
  console.log("usage: spike.ts stills|clip|bench …");
}
