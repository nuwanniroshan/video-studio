/**
 * Regenerates templates/<id>/thumb.jpg from a real frame, rendered in the template's theme:
 *   npx tsx scripts/template-thumbs.ts [id…]      (SHEETS=<dir> also writes a contact sheet per template)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepare, run, stills } from "../packages/render/src/index.ts";
import { materializeTheme } from "../packages/studio/src/index.ts";

const T = path.resolve("templates");
const only = process.argv.slice(2);
for (const id of fs.readdirSync(T).filter((d) => fs.existsSync(path.join(T, d, "spec.json")) && (!only.length || only.includes(d)))) {
  const meta = JSON.parse(fs.readFileSync(path.join(T, id, "template.json"), "utf8"));
  // a throwaway project: the template + its theme as the project's own brand
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `thumb-${id}-`));
  if (fs.existsSync(path.join(T, id, "assets"))) fs.cpSync(path.join(T, id, "assets"), path.join(work, "assets"), { recursive: true });
  const spec = JSON.parse(fs.readFileSync(path.join(T, id, "spec.json"), "utf8"));
  spec.brand = "tpl";
  fs.writeFileSync(path.join(work, "spec.json"), JSON.stringify(spec));
  materializeTheme(path.join(work, "brand"), "tpl", meta.theme ?? "classic", meta.product ?? "Northwind");
  const specPath = path.join(work, "spec.json");
  const p = await prepare(specPath, undefined);
  const v = p.variants[0];
  // the most visual scene: a product/feature scene if there is one, else the second scene, mid-way
  const s = v.resolved.scenes.find((x) => ["featureSpotlight", "screenFlow", "mediaBroll", "statsCounter"].includes(x.type)) ?? v.resolved.scenes[Math.min(1, v.resolved.scenes.length - 1)];
  const t = +(s.start + Math.min(3.2, (s.end - s.start) * 0.6)).toFixed(2);
  const r = await stills({ specPath, variant: v.id, times: [t], outDir: path.join(work, "thumb") });
  await run(["-i", r[0].files[0], "-vf", "scale=640:-2", "-q:v", "4", path.join(T, id, "thumb.jpg")]);
  if (process.env.SHEETS) {
    const all = await stills({ specPath, outDir: path.join(work, "sheets") });
    for (const x of all) if (x.sheet) fs.copyFileSync(x.sheet, path.join(process.env.SHEETS, `${id}-${x.variant}.jpg`));
    console.log(id, "lint:", all.map((x) => `${x.variant}=${x.lint.length}`).join(" "), "duration", v.doc.duration.toFixed(1));
    for (const x of all) for (const l of x.lint) console.log("   ", x.variant, l.scene, l.code, l.message);
  }
  console.log(id, v.id, t);
  fs.rmSync(work, { recursive: true, force: true });
}
process.exit(0);
