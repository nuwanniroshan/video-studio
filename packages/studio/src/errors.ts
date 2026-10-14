import fs from "node:fs";
import path from "node:path";
import { REPO } from "@vs/render";
export class StudioError extends Error { constructor(readonly status: number, msg: string, readonly issues?: { path: string; message: string }[]) { super(msg); } }
export const studioHome = () => process.env.VS_STUDIO_HOME ?? path.join(REPO, "studio-data");
export const cacheDir = () => process.env.VS_CACHE ?? path.join(REPO, ".vs-cache");
export const projectsDir = () => { const d = path.join(studioHome(), "projects"); fs.mkdirSync(d, { recursive: true }); return d; };
export const validId = (id: string) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(id);
/** A project's folder (throws 400/404). */
export const pdir = (id: string) => {
  if (!validId(id)) throw new StudioError(400, "bad project id");
  const d = path.join(projectsDir(), id);
  if (!fs.existsSync(path.join(d, "spec.json"))) throw new StudioError(404, `no project "${id}"`);
  return d;
};
