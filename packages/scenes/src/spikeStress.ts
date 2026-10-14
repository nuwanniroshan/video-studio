/** Spike-only scene (not in the public catalog): isolates SwiftShader costs of blur, 3D and big shadows. */
import type { SceneModule } from "./types.ts";
import { h } from "./text.ts";

export interface SpikeStressProps { mode: "plain" | "blur" | "3d" | "shadow"; cards?: number }

export const spikeStress: SceneModule<SpikeStressProps> = {
  type: "spikeStress",
  version: 1,
  meta: { label: "Spike stress", category: "custom", description: "Render-cost probe", defaultMusicCue: "groove" },
  mount(root, p, ctx) {
    const grid = h("div", "spike-grid");
    const n = p.cards ?? 12;
    for (let i = 0; i < n; i++) {
      const c = h("div", "spike-card", `<b>Card ${i + 1}</b><span>Lorem ipsum dolor sit amet</span>`);
      if (p.mode === "shadow") c.style.boxShadow = "var(--vs-shadow-xl), 0 60px 120px rgba(14,17,22,.25)";
      grid.append(c);
    }
    root.append(grid);
    if (p.mode === "3d") grid.style.perspective = "2400px";
    void ctx;
  },
  animate(tl, p, ctx) {
    const cards = tl.$$(".spike-card");
    cards.forEach((c, i) => {
      const t0 = (i % 4) * 0.08;
      if (p.mode === "blur") tl.tw(c, t0, ctx.end - t0, { blur: 14, y: 40 }, { blur: 0, y: -40 }, "linear");
      else if (p.mode === "3d") tl.tw(c, t0, ctx.end - t0, { rx: 26, ry: -22, y: 40 }, { rx: -10, ry: 12, y: -40 }, "linear");
      else tl.tw(c, t0, ctx.end - t0, { y: 40, s: 0.95 }, { y: -40, s: 1.05 }, "linear");
    });
  },
};
