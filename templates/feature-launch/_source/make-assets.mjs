// Regenerates the template's sample assets (original, royalty-free): node templates/feature-launch/_source/make-assets.mjs
import { chromium } from "../../../packages/render/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "assets");
const b = await chromium.launch({ args: ["--allow-file-access-from-files"] }); // offline asset generation only
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto("file://" + path.join(here, "mock.html"));
await p.evaluate(() => document.fonts.ready);
const boxes = {};
for (const n of [1, 2, 3]) {
  await p.evaluate((k) => { document.querySelectorAll("[data-screen]").forEach((e) => (e.style.display = e.dataset.screen === String(k) ? "flex" : "none"));
    document.getElementById("crumb").textContent = ["Pay runs", "Review", "Done"][k - 1]; }, n);
  await p.screenshot({ path: path.join(out, `flow-${n}.png`) });
  boxes[n] = await p.evaluate(() => [...document.querySelectorAll("[data-screen]:not([style*='none']) .btn.primary")].map((e) => {
    const r = e.getBoundingClientRect(); return { x: +((r.left + r.width / 2) / 1600).toFixed(3), y: +((r.top + r.height / 2) / 1000).toFixed(3) }; }));
}
await p.setViewportSize({ width: 1920, height: 1280 });
await p.goto("file://" + path.join(here, "broll.html"));
await p.screenshot({ path: path.join(out, "broll.jpg"), type: "jpeg", quality: 88 });
await b.close();
console.log(JSON.stringify(boxes));
