import { build } from "esbuild";
import fs from "node:fs";
fs.mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outfile: "dist/runtime.js",
  sourcemap: "inline",
  logLevel: "warning",
});
for (const f of fs.readdirSync("static")) fs.copyFileSync(`static/${f}`, `dist/${f}`);
console.log("runtime built");
