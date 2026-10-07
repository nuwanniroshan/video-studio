import type { SceneModule } from "./types.ts";
import { copyOut, unit } from "./motion.ts";
import { h, plain, richText } from "./text.ts";

export interface KineticTitleProps {
  kicker?: string;
  headline: string;
  sub?: string;
  style?: "rise" | "mask" | "typewriter" | "scale";
  align?: "center" | "left";
  /** Animate the copy out at the end of the scene (off when a transition carries it out). */
  exit?: boolean;
}

export const kineticTitle: SceneModule<KineticTitleProps> = {
  type: "kineticTitle",
  version: 1,
  meta: { label: "Kinetic title", category: "title", description: "Kicker, headline and sub with word-level motion.", defaultMusicCue: "build" },
  timing: (p) => ({ min: 1.6 + 0.055 * plain(p.headline).split(/\s+/).length + (p.sub ? 1.2 : 0) }),

  mount(root, p, ctx) {
    const wrap = h("div", `kt kt-${p.align ?? "center"}`);
    if (p.kicker) {
      const k = h("div", "vs-kicker");
      k.append(h("span", "bar"), h("span", "label vs-text", richText(p.kicker)));
      wrap.append(k);
    }
    const h1 = h("h1", "vs-h1 vs-text", p.style === "typewriter" ? "" : richText(p.headline));
    h1.dataset.fit = "h1";
    wrap.append(h1);
    if (p.sub) wrap.append(h("p", "vs-sub vs-text", richText(p.sub)));
    root.append(wrap);
    const u = unit(ctx.stage);
    if (p.style === "typewriter") h1.textContent = plain(p.headline); // measure with full text
    const max = (p.align === "left" ? 88 : ctx.orient === "portrait" ? 120 : 132) * u;
    ctx.fitText(h1, { min: 44 * u, max, maxHeight: ctx.stage.h * (ctx.orient === "portrait" ? 0.36 : 0.42) });
    if (p.style === "typewriter") h1.dataset.text = plain(p.headline);
  },

  animate(tl, p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    const kicker = root.querySelector(".vs-kicker");
    const h1 = root.querySelector<HTMLElement>(".vs-h1")!;
    const sub = root.querySelector(".vs-sub");
    const t = ctx.vo[0] ? Math.max(0.15, ctx.vo[0].t - 0.3) : 0.25; // visuals lead the voice slightly
    if (kicker) {
      tl.from(kicker, t, 0.7, { y: 16 * u, o: 0 });
      tl.tw(kicker.querySelector(".bar")!, t + 0.1, 0.7, { sx: 0 }, { sx: 1 }, "out");
    }
    const t1 = t + 0.12;
    switch (p.style ?? "rise") {
      case "rise":
        tl.revealWords(h1, t1, 0.055, 0.9, 44 * u);
        break;
      case "mask": {
        h1.classList.add("masked");
        const ws = tl.words(h1);
        const fs = parseFloat(getComputedStyle(h1).fontSize);
        ws.forEach((w, i) => tl.from(w, t1 + i * 0.06, 0.8, { y: fs * 1.1 }, "out"));
        break;
      }
      case "typewriter": {
        const text = h1.dataset.text ?? "";
        tl.type(h1, t1, Math.min(2.2, 0.045 * text.length), text);
        for (let i = 0; i < text.length; i += 3) tl.emit("type", t1 + (i / text.length) * Math.min(2.2, 0.045 * text.length));
        break;
      }
      case "scale":
        tl.tw(h1, t1, 1.4, { s: 1.16, o: 0, blur: 20 }, { s: 1, o: 1, blur: 0 }, "out");
        break;
    }
    tl.emit("whoosh", t1, { gain: 0.6 });
    if (sub) tl.from(sub, t + 0.55, 0.9, { y: 18 * u, o: 0, blur: 5 });
    if (p.exit !== false) copyOut(tl, root.querySelector(".kt")!, Math.max(t + 1.5, ctx.end - 0.55), u);
  },
};
