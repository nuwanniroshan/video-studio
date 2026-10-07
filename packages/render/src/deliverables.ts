/*
 * Deliverables (port of the prototype's finish.py; encode ladders from REFERENCE §7).
 * Inputs are the assembled silent picture, the mix and stems, and the resolved timeline.
 */
import fs from "node:fs";
import path from "node:path";
import type { ResolvedTimeline } from "@vs/timing";
import { run } from "./ffmpeg.ts";

export type DeliverableSet = "all" | "master" | "web" | "hero" | "landing" | "captions" | "stills" | "stems";
export interface DeliverableInput { video: string; mix: string; stems: Record<string, string>; resolved: ResolvedTimeline; outDir: string; base: string; fps: number }

const ts = (t: number, sep: "," | ".") => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
};

/** Captions: line start = VO t, end = t + dur + 0.25 s (clamped before the next line); display spelling. */
export function captions(r: ResolvedTimeline) {
  const lines = r.scenes.flatMap((s) => s.vo).sort((a, b) => a.t - b.t);
  const cues = lines.map((l, i) => ({ a: l.t, b: Math.min(l.t + l.dur + 0.25, lines[i + 1]?.t ?? Infinity, r.duration), text: l.text }));
  const srt = cues.map((c, i) => `${i + 1}\n${ts(c.a, ",")} --> ${ts(c.b, ",")}\n${c.text}\n`).join("\n");
  const vtt = "WEBVTT\n\n" + cues.map((c) => `${ts(c.a, ".")} --> ${ts(c.b, ".")}\n${c.text}\n`).join("\n");
  return { srt, vtt };
}

export async function deliverables(d: DeliverableInput, sets: DeliverableSet[] = ["all"], log: (m: string) => void = () => {}): Promise<string[]> {
  const want = (s: DeliverableSet) => sets.includes("all") || sets.includes(s);
  const O = (n: string) => path.join(d.outDir, `${d.base}_${n}`);
  const files: string[] = [];
  const dur = String(d.resolved.duration);
  const step = async (name: string, f: string, args: string[]) => {
    const t = Date.now();
    await run(args);
    files.push(f);
    log(`  ${name}: ${path.basename(f)} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  };
  const av = ["-i", d.video, "-i", d.mix, "-map", "0:v", "-map", "1:a", "-t", dur];
  if (want("master")) await step("master", O("master.mp4"), [...av, "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", O("master.mp4")]);
  if (want("web")) await step("web", O("web.mp4"), [...av, "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-maxrate", "9M", "-bufsize", "18M", "-profile:v", "high",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", O("web.mp4")]);
  if (want("hero")) {
    await step("hero mp4", O("hero_muted.mp4"), ["-i", d.video, "-t", dur, "-an", "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", O("hero_muted.mp4")]);
    await step("hero webm", O("hero_muted.webm"), ["-i", d.video, "-t", dur, "-an", "-r", "30", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", O("hero_muted.webm")]);
  }
  if (want("landing")) {
    await step("landing mp4", O("landing.mp4"), [...av, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-maxrate", "5M", "-bufsize", "10M", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", O("landing.mp4")]);
    await step("landing webm", O("landing.webm"), [...av, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "37", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
      "-c:a", "libopus", "-b:a", "112k", O("landing.webm")]);
  }
  if (want("captions")) {
    const c = captions(d.resolved);
    fs.writeFileSync(O("en.srt"), c.srt); fs.writeFileSync(O("en.vtt"), c.vtt);
    files.push(O("en.srt"), O("en.vtt"));
  }
  if (want("stills")) {
    // poster = the held end card (not frame 0, which is black after a fade); thumbs mid-scene
    const shots: [number, string][] = [[d.resolved.duration - 1.0, "poster"]];
    d.resolved.scenes.slice(0, -1).forEach((s, i) => shots.push([(s.start + s.end) / 2 + 0.6, `thumb_${String(i + 1).padStart(2, "0")}_${s.id}`]));
    for (const [t, n] of shots) await step(n, O(`${n}.jpg`), ["-ss", t.toFixed(3), "-i", d.video, "-frames:v", "1", "-q:v", "2", O(`${n}.jpg`)]);
  }
  if (want("stems")) {
    for (const [n, f] of Object.entries(d.stems)) await step(`stem ${n}`, O(`stem_${n}.wav`), ["-i", f, "-c:a", "pcm_s24le", O(`stem_${n}.wav`)]);
    await step("mix", O("mix.wav"), ["-i", d.mix, "-c:a", "pcm_s24le", O("mix.wav")]);
  }
  return files;
}
