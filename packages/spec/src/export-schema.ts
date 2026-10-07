import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchema } from "./index.ts";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/schema.json");
fs.writeFileSync(out, JSON.stringify(jsonSchema(), null, 2) + "\n");
console.log("wrote", out);
