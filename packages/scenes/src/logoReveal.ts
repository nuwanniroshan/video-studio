import type { z } from "zod";
import type { logoReveal as def } from "@vs/spec";
import type { SceneModule } from "./types.ts";
import { background, exitTime, fitHeadline, unit } from "./parts.ts";
import { h, richText } from "./text.ts";

type P = z.output<typeof def.schema>;

export const logoReveal: SceneModule<P> = {
  type: "logoReveal",
  version: 1,
  meta: { label: "Logo reveal", category: "title", description: "", defaultMusicCue: "reveal" },
  mount(root, p, ctx) {
    background(root, ctx.tone);
    const src = p.logo ? ctx.url(p.logo) : ctx.tone === "light" ? ctx.brand.logoOnLight : ctx.brand.logoOnDark;
    const wrap = h("div", "lr");
    if (p.glow) wrap.append(h("div", "lr-glow"));
    if (p.flare) wrap.append(h("div", "lr-flare"));
    const logo = h("div", "lr-logo");
    const img = h("img", "");
    img.src = src;
    img.alt = ctx.brand.name;
    logo.append(img);
    if (p.sheen) {
      const sh = h("div", "lr-sheen");
      sh.style.setProperty("-webkit-mask-image", `url("${src}")`);
      logo.append(sh);
    }
    wrap.append(logo);
    if (p.tagline) wrap.append(h("div", "lr-tag vs-h1 vs-text", richText(p.tagline)));
    root.append(wrap);
    fitHeadline(ctx, wrap.querySelector<HTMLElement>(".lr-tag") ?? undefined, ctx.orient === "portrait" ? 72 : 64, 34, 0.2);
  },
  animate(tl, p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    const logo = root.querySelector<HTMLElement>(".lr-logo")!;
    const t0 = ctx.inT ? Math.max(0, (ctx.inT.start + ctx.inT.end) / 2 - 0.05) : 0.1;
    tl.tw(logo, t0, 1.6, { s: 1.16, o: 0, blur: 26 }, { s: 1, o: 1, blur: 0 }, "out");
    tl.to(logo, t0 + 1.6, Math.max(0.5, ctx.end - t0 - 2.2), { s: 0.97 }, "soft");
    const glow = root.querySelector(".lr-glow");
    if (glow) tl.tw(glow, t0, 2.5, { o: 0, s: 0.8 }, { o: 0.42, s: 1.3 }, "out");
    const flare = root.querySelector(".lr-flare");
    if (flare) {
      tl.tw(flare, t0, 0.35, { o: 0, sx: 0.1 }, { o: 1, sx: 1.2 }, "out");
      tl.to(flare, t0 + 0.35, 0.8, { o: 0, sx: 1.6 }, "out");
    }
    const sheen = root.querySelector<HTMLElement>(".lr-sheen");
    if (sheen) {
      tl.fn(t0 + 0.35, 1.3, (q) => (sheen.style.backgroundPosition = `${(100 - 100 * q).toFixed(2)}% 0`), { ease: "smooth", key: "sheen" });
      tl.emit("sparkle", t0 + 0.35, { gain: 0.8 });
    }
    const tag = root.querySelector<HTMLElement>(".lr-tag");
    if (tag) {
      const tt = ctx.vo[1]?.t ?? ctx.vo[0]?.t ?? t0 + 2.0;
      tl.revealWords(tag, Math.max(t0 + 1.3, tt - 0.25), 0.07, 1.0, 36 * u);
    }
    const x = exitTime(ctx, 0.6);
    if (x !== null) {
      tl.to(logo, x, 0.55, { y: -50 * u, o: 0, blur: 10, s: 0.94 }, "in");
      if (tag) tl.to(tag, x + 0.08, 0.5, { y: -40 * u, o: 0, blur: 10 }, "in");
      if (glow) tl.to(glow, x - 0.2, 0.8, { o: 0 }, "in");
    }
  },
};
