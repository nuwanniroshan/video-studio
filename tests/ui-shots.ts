/** Screenshots of studio pages for visual QA: npx tsx tests/ui-shots.ts [path…] */
import { chromium } from "playwright";
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ["#/", "#/templates", "#/idea", "#/brands", "#/brands/luraplus", "#/brands/new"];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
for (const h of pages) {
  await p.goto(`http://127.0.0.1:5190/${h}`);
  await p.waitForTimeout(h.startsWith("#/p/") ? 9000 : 2500);
  const name = h.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
  await p.screenshot({ path: `out/ui/${name}.png`, fullPage: !h.startsWith("#/p/") });
  console.log(name);
}
await b.close();
