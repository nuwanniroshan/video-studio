import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "./env.ts";

/** Runs `python -m vsaudio <cmd> in.json out.json` (JSON in, files out). */
export async function vsaudio<T = any>(cmd: "tts" | "mix" | "qa", input: unknown): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsaudio-"));
  const inp = path.join(dir, "in.json"), out = path.join(dir, "out.json");
  fs.writeFileSync(inp, JSON.stringify(input));
  await new Promise<void>((res, rej) => {
    const p = spawn(env.python(), ["-m", "vsaudio", cmd, inp, out], {
      env: { ...process.env, PYTHONPATH: env.pythonPath() + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : "") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.stdout.on("data", () => {});
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`vsaudio ${cmd} failed (${c}):\n${err.slice(-3000)}`))));
  });
  const r = JSON.parse(fs.readFileSync(out, "utf8")) as T;
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}
