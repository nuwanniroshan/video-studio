import type { z } from "zod";
import type { featureGrid as def } from "@vs/spec";
import type { SceneModule } from "./types.ts";
import { animateBackground, background, copyBlock, copyIn, copyOut, exitTime, fitHeadline, startTime, unit } from "./parts.ts";
import { h } from "./text.ts";
import { iconSvg } from "./icons.ts";

type P = z.output<typeof def.schema>;

export const featureGrid: SceneModule<P> = {
  type: "featureGrid",
  version: 1,
  meta: { label: "Feature grid", category: "feature", description: "", defaultMusicCue: "groove" },
  mount(root, p, ctx) {
    background(root, ctx.tone);
    const n = p.items.length;
    const cols = ctx.orient === "landscape" ? (n <= 4 ? n : 3) : ctx.orient === "square" ? (n <= 2 ? n : 2) : n <= 3 ? 1 : 2;
    const wrap = h("div", `fg fg-${ctx.orient}`);
    const c = copyBlock({ kicker: p.kicker, headline: p.headline }, "fg-copy copy");
    wrap.append(c.wrap);
    const grid = h("div", "fg-grid");
    grid.style.setProperty("--cols", String(cols));
    grid.dataset.rows = String(Math.ceil(n / cols));
    for (const it of p.items) {
      const card = h("div", "fg-card card");
      card.innerHTML = `<div class="fg-icon">${iconSvg(it.icon)}</div>`;
      const t = h("div", "fg-title vs-text"); t.textContent = it.title; card.append(t);
      if (it.text) { const l = h("div", "fg-text vs-text"); l.textContent = it.text; card.append(l); }
      grid.append(card);
    }
    wrap.append(grid);
    root.append(wrap);
    fitHeadline(ctx, c.h1, ctx.orient === "landscape" ? 76 : 84, 40, 0.18);
  },
  animate(tl, _p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    animateBackground(tl, root, ctx);
    const t = startTime(ctx);
    const copy = root.querySelector<HTMLElement>(".fg-copy")!;
    copyIn(tl, { wrap: copy, kicker: copy.querySelector<HTMLElement>(".vs-kicker") ?? undefined, h1: copy.querySelector<HTMLElement>(".vs-h1") ?? undefined }, t, u);
    const cards = [...root.querySelectorAll<HTMLElement>(".fg-card")];
    cards.forEach((card, i) => {
      // each card lands on its step (VO-bound) but never before the headline has started
      const ts = Math.max(t + 0.35 + i * 0.12, (ctx.steps[i]?.start ?? 0) - 0.1);
      tl.tw(card, ts, 1.0, { y: 70 * u, o: 0, rx: 16, blur: 6 }, { y: 0, o: 1, rx: 0, blur: 0 }, "out");
      tl.from(card.querySelector(".fg-icon")!, ts + 0.25, 0.5, { s: 0.4, o: 0 }, "back");
      tl.emit("pop", ts + 0.25, { gain: 0.3, pan: cards.length > 1 ? -0.5 + i / (cards.length - 1) : 0 });
    });
    const x = exitTime(ctx);
    if (x !== null) {
      copyOut(tl, copy, x, u);
      cards.forEach((c, i) => tl.to(c, x + i * 0.03, 0.42, { y: -30 * u, o: 0, blur: 6 }, "in"));
    }
  },
};
