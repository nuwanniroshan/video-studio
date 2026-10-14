import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (packages/render/src → ../../..). */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const env = {
  brandsDir: () => process.env.VS_BRANDS ?? path.join(REPO, "brands"),
  cacheDir: () => process.env.VS_CACHE ?? path.join(REPO, ".vs-cache"),
  modelsDir: () => process.env.VS_MODELS ?? path.join(REPO, "models"),
  python: () => process.env.VS_PYTHON ?? (fs.existsSync(path.join(REPO, ".venv/bin/python")) ? path.join(REPO, ".venv/bin/python") : "python3"),
  pythonPath: () => path.join(REPO, "python"),
};
