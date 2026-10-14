import type { z } from "zod";
import type { statsCounter as def } from "@vs/spec";
import type { SceneModule } from "./types.ts";
import { animateBackground, background, copyBlock, copyIn, copyOut, exitTime, fitHeadline, startTime, unit } from "./parts.ts";
import { h } from "./text.ts";

type P = z.output<typeof def.schema>;
const fmtNum = (v: number, decimals: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const statsCounter: SceneModule<P> = {
  type: "statsCounter",
  version: 1,
  meta: { label: "Stats counter", category: "proof", description: "", defaultMusicCue: "groove" },
  mount(root, p, ctx) {
    background(root, ctx.tone);
    const wrap = h("div", `sc sc-${ctx.orient}`);
    const c = copyBlock({ kicker: p.kicker, headline: p.headline }, "sc-copy copy");
    wrap.append(c.wrap);
    const row = h("div", "sc-row");
    row.style.setProperty("--n", String(p.stats.length));
    for (const s of p.stats) {
      const st = h("div", "sc-stat");
      const v = h("div", "sc-value vs-text");
      v.innerHTML = `${s.prefix ? `<span class="sc-affix"></span>` : ""}<span class="sc-num"></span>${s.suffix ? `<span class="sc-affix sc-suffix"></span>` : ""}`;
      if (s.prefix) v.querySelector(".sc-affix")!.textContent = s.prefix;
      if (s.suffix) v.querySelector(".sc-suffix")!.textContent = s.suffix;
      v.querySelector(".sc-num")!.textContent = fmtNum(s.value, s.decimals); // measure at final width
      v.dataset.fit = "stat";
      const l = h("div", "sc-label vs-text"); l.textContent = s.label;
      st.append(v, h("div", "sc-rule"), l);
      row.append(st);
    }
    wrap.append(row);
    root.append(wrap);
    fitHeadline(ctx, c.h1, ctx.orient === "landscape" ? 76 : 84, 40, 0.18);
    // one font size for all values: the largest that fits every stat
    const u = unit(ctx.stage);
    const vals = [...row.querySelectorAll<HTMLElement>(".sc-value")];
    const size = Math.min(...vals.map((v) => ctx.fitText(v, { min: 48 * u, max: (ctx.orient === "landscape" ? 150 : 170) * u })));
    vals.forEach((v) => (v.style.fontSize = size + "px"));
  },
  animate(tl, p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    animateBackground(tl, root, ctx);
    const t = startTime(ctx);
    const copy = root.querySelector<HTMLElement>(".sc-copy")!;
    copyIn(tl, { wrap: copy, kicker: copy.querySelector<HTMLElement>(".vs-kicker") ?? undefined, h1: copy.querySelector<HTMLElement>(".vs-h1") ?? undefined }, t, u);
    const stats = [...root.querySelectorAll<HTMLElement>(".sc-stat")];
    stats.forEach((el, i) => {
      const ts = t + 0.45 + i * 0.18;
      tl.from(el, ts, 0.9, { y: 34 * u, o: 0 });
      tl.tw(el.querySelector(".sc-rule")!, ts + 0.2, 0.9, { sx: 0 }, { sx: 1 }, "out");
      const s = p.stats[i];
      const d = 1.6;
      tl.count(el.querySelector(".sc-num")!, ts + 0.1, d, 0, s.value, (v) => fmtNum(v, s.decimals), "out");
      tl.emit("pop", ts + 0.1 + d * 0.6, { gain: 0.25 });
    });
    const x = exitTime(ctx);
    if (x !== null) {
      copyOut(tl, copy, x, u);
      stats.forEach((s, i) => tl.to(s, x + i * 0.04, 0.42, { y: -30 * u, o: 0, blur: 6 }, "in"));
    }
  },
};
