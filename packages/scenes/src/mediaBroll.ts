import type { z } from "zod";
import type { mediaBroll as def } from "@vs/spec";
import type { SceneModule } from "./types.ts";
import { copyBlock, copyIn, copyOut, exitTime, fitHeadline, startTime, unit } from "./parts.ts";
import { h } from "./text.ts";

type P = z.output<typeof def.schema>;

export const mediaBroll: SceneModule<P> = {
  type: "mediaBroll",
  version: 1,
  meta: { label: "Media B-roll", category: "media", description: "", defaultMusicCue: "groove" },
  mount(root, p, ctx) {
    const wrap = h("div", `mb mb-${p.position} mb-tint-${p.tint}`);
    const media = h("div", "mb-media");
    const img = h("img", "mb-img");
    img.src = ctx.url(p.media);
    img.style.objectPosition = `${(p.focusX * 100).toFixed(1)}% 50%`;
    media.append(img);
    if (p.tint === "duotone") media.append(h("div", "mb-duo-a"), h("div", "mb-duo-b"));
    wrap.append(media);
    if (p.tint !== "none") wrap.append(h("div", "mb-shade"));
    if (p.vignette) wrap.append(h("div", "mb-vignette"));
    if (p.headline || p.sub) wrap.append(copyBlock({ headline: p.headline, body: p.sub }, "mb-copy copy").wrap);
    root.append(wrap);
    fitHeadline(ctx, wrap.querySelector<HTMLElement>(".vs-h1") ?? undefined, ctx.orient === "landscape" ? 84 : 96, 40, 0.24);
  },
  animate(tl, p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    const img = root.querySelector<HTMLElement>(".mb-img")!;
    const a = ctx.inT ? ctx.inT.start : 0, b = ctx.outT ? ctx.outT.end : ctx.end;
    const drift = 40 * u;
    const from = { in: { s: 1.0 }, out: { s: 1.1 }, left: { s: 1.08, x: drift }, right: { s: 1.08, x: -drift }, none: { s: 1.04 } }[p.motion];
    const to = { in: { s: 1.1 }, out: { s: 1.0 }, left: { s: 1.08, x: -drift }, right: { s: 1.08, x: drift }, none: { s: 1.04 } }[p.motion];
    tl.tw(img, a, b - a, from, to, "linear");
    const copy = root.querySelector<HTMLElement>(".mb-copy");
    if (copy) {
      copyIn(tl, { wrap: copy, h1: copy.querySelector<HTMLElement>(".vs-h1") ?? undefined, body: copy.querySelector<HTMLElement>(".vs-sub") ?? undefined }, startTime(ctx), u);
      const x = exitTime(ctx);
      if (x !== null) copyOut(tl, copy, x, u);
    }
  },
};
