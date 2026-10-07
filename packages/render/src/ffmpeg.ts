import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export function run(args: string[], opts: { quiet?: boolean } = {}): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", opts.quiet === false ? "info" : "error", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => (c === 0 ? res(err) : rej(new Error(`ffmpeg exited ${c}: ${err.slice(-2000)}`))));
  });
}

export function probe(file: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", ["-v", "error", ...args, file]);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => (c === 0 ? res(out.trim()) : rej(new Error(err))));
  });
}

/** Segment encoder fed with images on stdin; sub-frames are averaged by tmix (motion blur). */
export function segmentEncoder(out: string, o: { fps: number; sub: number; codec: "png" | "mjpeg"; crf: number; post?: string }): {
  proc: ChildProcessWithoutNullStreams; write(buf: Buffer): Promise<void>; end(): Promise<void>;
} {
  const blur = o.sub > 1 ? `tmix=frames=${o.sub},select='eq(mod(n\\,${o.sub})\\,${o.sub - 1})',setpts=N/(${o.fps}*TB)` : "null";
  const vf = o.post ? `${blur},${o.post}` : blur;
  const proc = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(o.fps * o.sub), "-c:v", o.codec, "-i", "-",
    "-vf", vf, "-r", String(o.fps),
    // fixed, closed-GOP parameters so segments concatenate by stream copy
    "-c:v", "libx264", "-preset", "medium", "-crf", String(o.crf), "-pix_fmt", "yuv420p",
    "-g", String(o.fps * 2), "-sc_threshold", "0", "-x264-params", "open-gop=0",
    "-video_track_timescale", String(o.fps * 1000), out,
  ]);
  let err = "";
  proc.stderr.on("data", (d) => (err += d));
  const done = new Promise<void>((res, rej) => proc.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${err}`)))));
  return {
    proc,
    write: (buf) => new Promise((res) => (proc.stdin.write(buf) ? res() : proc.stdin.once("drain", res))),
    end: async () => { proc.stdin.end(); await done; },
  };
}

export async function concat(files: string[], listFile: string, out: string) {
  const fs = await import("node:fs");
  fs.writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await run(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out]);
}
