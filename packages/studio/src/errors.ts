import path from "node:path";
import { REPO } from "@vs/render";
export class StudioError extends Error { constructor(readonly status: number, msg: string, readonly issues?: { path: string; message: string }[]) { super(msg); } }
export const studioHome = () => process.env.VS_STUDIO_HOME ?? path.join(REPO, "studio-data");
export const cacheDir = () => process.env.VS_CACHE ?? path.join(REPO, ".vs-cache");
