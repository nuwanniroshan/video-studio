/** Regenerates templates/<id>/thumb.jpg from a real frame: npx tsx scripts/template-thumbs.ts */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepare, run, stills } from "@vs/render";

const T = path.resolve("templates");
for (const id of fs.readdirSync(T).filter((d) => fs.existsSync(path.join(T, d, "spec.json")))) {
  const spec = path.join(T, id, "spec.json");
  const p = await prepare(spec, undefined);
  const v = p.variants[0];
  // the most visual scene: a product/feature scene if there is one, else the second scene, mid-way
  const s = v.resolved.scenes.find((x) => ["featureSpotlight", "screenFlow", "mediaBroll", "statsCounter"].includes(x.type)) ?? v.resolved.scenes[Math.min(1, v.resolved.scenes.length - 1)];
  const t = +(s.start + Math.min(3.2, (s.end - s.start) * 0.6)).toFixed(2);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "thumb-"));
  const r = await stills({ specPath: spec, variant: v.id, times: [t], outDir: out });
  await run(["-i", r[0].files[0], "-vf", "scale=640:-2", "-q:v", "4", path.join(T, id, "thumb.jpg")]);
  console.log(id, v.id, t);
}
