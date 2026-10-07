import { build } from "esbuild";
import fs from "node:fs";
fs.mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outfile: "dist/runtime.js",
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
});
for (const f of fs.readdirSync("static")) fs.copyFileSync(`static/${f}`, `dist/${f}`);
fs.copyFileSync("../scenes/src/styles.css", "dist/scenes.css");
console.log("runtime built");
