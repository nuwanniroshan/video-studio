/*
 * Content-addressed local storage (S3 arrives in M2 behind the same interface).
 * Layout under the cache root: assets/<sha>.<ext>, seg/<key>.mp4, vo/…, renders/…
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const sha256 = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
/** Stable JSON (sorted keys) for hashing. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const hashJson = (v: unknown) => sha256(stableJson(v));

export class LocalStore {
  constructor(readonly root: string) { fs.mkdirSync(root, { recursive: true }); }
  dir(kind: string) { const d = path.join(this.root, kind); fs.mkdirSync(d, { recursive: true }); return d; }

  /** Copy a file into assets/ by content hash. Returns its sha and stored name. */
  putAsset(file: string): { sha: string; name: string; path: string } {
    const sha = sha256File(file);
    const name = `${sha}${path.extname(file).toLowerCase()}`;
    const dst = path.join(this.dir("assets"), name);
    if (!fs.existsSync(dst)) fs.copyFileSync(file, dst);
    return { sha, name, path: dst };
  }
  findAsset(sha: string): string | null {
    const d = this.dir("assets");
    const f = fs.readdirSync(d).find((n) => n.startsWith(sha));
    return f ? path.join(d, f) : null;
  }
  has(kind: string, name: string) { return fs.existsSync(path.join(this.root, kind, name)); }
  path(kind: string, name: string) { return path.join(this.dir(kind), name); }
  /** Atomically move a finished file into the store. */
  commit(kind: string, name: string, from: string) {
    const dst = this.path(kind, name);
    fs.renameSync(from, dst);
    return dst;
  }
}
