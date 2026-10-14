/*
 * Golden frames (PLAN §14): every scene × aspect × fixture (example + long-text stress) at two cue times,
 * compared by SSIM ≥ 0.985 against tests/golden/baseline. Run inside the pinned render image:
 *   scripts/golden.sh            # compare
 *   scripts/golden.sh --update   # refresh baselines
 * Stress fixtures must produce zero lint errors.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENE_DEFS } from "@vs/spec";
import { buildDoc, loadProject, openPage, resolveVariant, run, seek, serveProject } from "@vs/render";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.GOLDEN_BASE ?? path.join(HERE, "baseline");
const OUT = path.join(os.tmpdir(), `vs-golden-${process.pid}`);
const update = process.argv.includes("--update");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const THRESH = 0.985;
const ASPECTS = ["16:9", "9:16"] as const;

const toneFor = (t: string) => (["logoReveal", "ctaEndCard", "kineticTitle"].includes(t) ? "dark" : "light");
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(HERE, "assets"), path.join(OUT, "assets"), { recursive: true }); // fixtures reference assets/…
fs.mkdirSync(BASE, { recursive: true });

let fail = 0, pass = 0, created = 0;
const lintErrors: string[] = [];
for (const d of SCENE_DEFS) {
  if (only && d.type !== only) continue;
  for (const fx of ["example", "stress", ...Object.keys(d.fixtures ?? {})]) {
    // a one-scene spec per fixture; VO-free so timing is deterministic without TTS
    const spec = { version: 1, title: `golden ${d.type} ${fx}`, brand: "luraplus", fps: 30, music: { mode: "none" },
      variants: ASPECTS.map((a) => ({ id: (a === "16:9" ? "l" : "p") + a.replace(":", "x"), aspect: a, safeArea: "title" })),
      scenes: [{ id: "s", type: d.type, tone: toneFor(d.type), duration: { mode: "fixed", seconds: 6 }, props: fx === "example" || fx === "stress" ? d[fx] : d.fixtures![fx] }] };
    const sp = path.join(OUT, `fixture-${d.type}-${fx}.json`);
    fs.writeFileSync(sp, JSON.stringify(spec));
    const p = loadProject(sp, { cacheDir: path.join(OUT, "cache") });
    const srv = await serveProject(p);
    try {
      for (const v of p.spec.variants) {
        const doc = buildDoc(p, resolveVariant(p, v.id, new Map()));
        const { browser, page, load } = await openPage(srv.origin, doc, 0.5);
        for (const l of load.lint) {
          if (l.level === "error") lintErrors.push(`${d.type}/${fx}/${v.id}: ${l.code} ${l.message}`);
          else console.log(`! lint warning ${d.type}/${fx}/${v.id}: ${l.code} ${l.message}`);
        }
        for (const t of [2.6, 5.4]) {
          await seek(page, t);
          const name = `${d.type}__${fx}__${v.id}__${t.toFixed(1)}.png`;
          const got = path.join(OUT, name), want = path.join(BASE, name);
          await page.screenshot({ path: got });
          if (update || !fs.existsSync(want)) { fs.copyFileSync(got, want); created++; continue; }
          const log = await run(["-i", got, "-i", want, "-lavfi", "ssim", "-f", "null", "-"], { quiet: false });
          const ssim = +(log.match(/All:([\d.]+)/)?.[1] ?? 0);
          if (ssim >= THRESH) pass++;
          else { fail++; console.log(`✗ ${name}: SSIM ${ssim.toFixed(4)} < ${THRESH}  (got: ${got})`); }
        }
        await browser.close();
      }
    } finally {
      await srv.close();
      fs.rmSync(sp);
    }
  }
}
lintErrors.forEach((e) => console.log(`✗ lint error: ${e}`));
console.log(JSON.stringify({ pass, fail, created, lintErrors: lintErrors.length, threshold: THRESH }));
process.exit(fail || lintErrors.length ? 1 : 0);
