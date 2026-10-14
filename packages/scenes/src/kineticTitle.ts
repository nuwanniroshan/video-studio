import type { z } from "zod";
import type { kineticTitle as def } from "@vs/spec";
import type { SceneModule } from "./types.ts";
import { animateBackground, background, copyOut, exitTime, startTime, unit } from "./parts.ts";
import { h, plain, richText } from "./text.ts";

type P = z.output<typeof def.schema>;

export const kineticTitle: SceneModule<P> = {
  type: "kineticTitle",
  version: 1,
  meta: { label: "Kinetic title", category: "title", description: "", defaultMusicCue: "build" },
  mount(root, p, ctx) {
    background(root, ctx.tone);
    const wrap = h("div", `kt kt-${p.align}`);
    if (p.kicker) {
      const k = h("div", "vs-kicker");
      k.append(h("span", "bar"), h("span", "label vs-text", richText(p.kicker)));
      wrap.append(k);
    }
    const h1 = h("h1", "vs-h1 vs-text", p.style === "typewriter" ? plain(p.headline) : richText(p.headline));
    h1.dataset.fit = "h1";
    wrap.append(h1);
    if (p.sub) wrap.append(h("p", "vs-sub vs-text", richText(p.sub)));
    root.append(wrap);
    const u = unit(ctx.stage);
    const max = (p.align === "left" ? 92 : ctx.orient === "portrait" ? 120 : 132) * u;
    ctx.fitText(h1, { min: 44 * u, max, maxHeight: ctx.stage.h * (ctx.orient === "portrait" ? 0.36 : 0.42) });
    if (p.style === "typewriter") { h1.dataset.text = plain(p.headline); h1.style.minHeight = h1.getBoundingClientRect().height + "px"; }
  },
  animate(tl, p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    animateBackground(tl, root, ctx);
    const kicker = root.querySelector(".vs-kicker");
    const h1 = root.querySelector<HTMLElement>(".vs-h1")!;
    const sub = root.querySelector(".vs-sub");
    const t = startTime(ctx);
    if (kicker) {
      tl.from(kicker, t, 0.7, { y: 16 * u, o: 0 });
      tl.tw(kicker.querySelector(".bar")!, t + 0.1, 0.7, { sx: 0 }, { sx: 1 }, "out");
    }
    const t1 = t + 0.12;
    switch (p.style) {
      case "mask": {
        h1.classList.add("masked");
        const ws = tl.words(h1);
        const fs = parseFloat(getComputedStyle(h1).fontSize);
        ws.forEach((w, i) => tl.from(w, t1 + i * 0.06, 0.8, { y: fs * 1.1 }, "out"));
        break;
      }
      case "typewriter": {
        const text = h1.dataset.text ?? "";
        const d = Math.min(2.2, 0.045 * text.length);
        tl.type(h1, t1, d, text);
        for (let i = 0; i < text.length; i += 2) tl.emit("type", t1 + (i / text.length) * d, { gain: 0.5 });
        break;
      }
      case "scale":
        tl.tw(h1, t1, 1.4, { s: 1.16, o: 0, blur: 20 }, { s: 1, o: 1, blur: 0 }, "out");
        break;
      default:
        tl.revealWords(h1, t1, 0.055, 0.9, 44 * u);
    }
    if (p.style !== "typewriter") tl.emit("whoosh", t1, { gain: 0.35 });
    if (sub) tl.from(sub, t + 0.55, 0.9, { y: 18 * u, o: 0, blur: 5 });
    const x = exitTime(ctx);
    if (p.exit && x !== null) copyOut(tl, root.querySelector(".kt")!, Math.max(t + 1.5, x), u);
  },
};
