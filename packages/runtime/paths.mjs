import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export const runtimeDist = path.join(here, "dist");
export const runtimeStatic = path.join(here, "static");
