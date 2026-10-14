import type { z } from "zod";
import type { ctaEndCard as def } from "@vs/spec";
import type { SceneModule } from "./types.ts";
import { background, cursor, fitHeadline, rel, startTime, unit } from "./parts.ts";
import { h, richText } from "./text.ts";
import { iconSvg } from "./icons.ts";

type P = z.output<typeof def.schema>;

export const ctaEndCard: SceneModule<P> = {
  type: "ctaEndCard",
  version: 1,
  meta: { label: "CTA end card", category: "close", description: "", defaultMusicCue: "resolve" },
  mount(root, p, ctx) {
    background(root, ctx.tone);
    const wrap = h("div", `cta cta-${ctx.orient}`);
    wrap.append(h("div", "cta-glow"));
    const col = h("div", "cta-col");
    if (p.logo) {
      const src = ctx.tone === "light" ? ctx.brand.logoOnLight : ctx.brand.logoOnDark;
      const logo = h("div", "cta-logo");
      const img = h("img", ""); img.src = src; img.alt = ctx.brand.name;
      const sh = h("div", "lr-sheen"); sh.style.setProperty("-webkit-mask-image", `url("${src}")`);
      logo.append(img, sh);
      col.append(logo);
    }
    col.append(h("h2", "vs-h1 cta-h1 vs-text", richText(p.headline)));
    const act = h("div", "cta-actions");
    const btn = h("span", "cta-btn vs-text");
    btn.innerHTML = `<span></span>${iconSvg("arrow")}`;
    btn.querySelector("span")!.textContent = p.button;
    act.append(btn);
    const url = p.url ?? ctx.brand.ctaUrl;
    if (url) { const u = h("span", "cta-url vs-text"); u.textContent = url; act.append(u); }
    col.append(act);
    if (p.note) { const n = h("div", "cta-note vs-text"); n.textContent = p.note; col.append(n); }
    wrap.append(col);
    root.append(wrap);
    if (p.click) cursor(root);
    fitHeadline(ctx, col.querySelector<HTMLElement>(".cta-h1")!, ctx.orient === "landscape" ? 84 : 92, 40, 0.24);
    root.dataset.btn = JSON.stringify(rel(btn, root));
  },
  animate(tl, p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    const t0 = ctx.inT ? Math.max(0, (ctx.inT.start + ctx.inT.end) / 2) : 0.1;
    const glow = root.querySelector(".cta-glow")!;
    tl.tw(glow, t0 - 0.1, 2.4, { o: 0, s: 0.6 }, { o: 1, s: 1 }, "out");
    const logo = root.querySelector<HTMLElement>(".cta-logo");
    if (logo) {
      tl.tw(logo, t0, 1.5, { s: 1.18, o: 0, blur: 26 }, { s: 1, o: 1, blur: 0 }, "out");
      const sh = logo.querySelector<HTMLElement>(".lr-sheen")!;
      const sweep = (a: number) => tl.fn(a, 1.3, (q) => (sh.style.backgroundPosition = `${(100 - 100 * q).toFixed(2)}% 0`), { ease: "smooth", key: "cta-sheen" });
      sweep(t0 + 0.45);
      tl.emit("sparkle", t0 + 0.45, { gain: 0.6 });
    }
    const tH = Math.max(t0 + 0.75, startTime(ctx));
    tl.revealWords(root.querySelector(".cta-h1")!, tH, 0.06, 1.0, 40 * u);
    const btn = root.querySelector<HTMLElement>(".cta-btn")!;
    const tB = Math.max(tH + 1.4, (ctx.vo[1]?.t ?? tH + 1.4) - 0.2);
    tl.tw(btn, tB, 0.9, { y: 34 * u, o: 0, s: 0.94 }, { y: 0, o: 1, s: 1 }, "out");
    const url = root.querySelector(".cta-url");
    if (url) tl.from(url, tB + 0.3, 0.8, { x: -14 * u, o: 0 });
    const note = root.querySelector(".cta-note");
    if (note) tl.from(note, tB + 0.8, 0.9, { y: 14 * u, o: 0 });
    const cur = root.querySelector<HTMLElement>(".cursor");
    if (p.click && cur) {
      const b = JSON.parse(root.dataset.btn!);
      // the click lands mid-hold; the final musical hit is synced to it
      const tc = Math.min(ctx.end - 3.2, tB + 2.6);
      tl.hide(cur).set(cur, tc - 1.25, { x: b.cx + 260 * u, y: b.cy + 230 * u }).to(cur, tc - 1.2, 0.3, { o: 1 });
      tl.to(cur, tc - 1.15, 0.9, { x: b.cx + 40 * u, y: b.cy + 8 * u }, "smooth");
      tl.tw(btn, tc - 0.4, 0.3, null, { bright: 1.12 });
      tl.tw(cur, tc, 0.08, null, { s: 0.82 }).tw(cur, tc + 0.1, 0.25, null, { s: 1 });
      tl.tw(btn, tc, 0.08, null, { s: 0.95 }).tw(btn, tc + 0.09, 0.35, null, { s: 1 });
      tl.emit("click", tc);
      tl.emit("final", tc);
      tl.to(cur, tc + 0.65, 0.8, { x: b.cx + 240 * u, y: b.cy + 260 * u }, "smooth");
      tl.to(cur, tc + 0.95, 0.3, { o: 0 });
      tl.tw(btn, tc + 0.75, 0.5, null, { bright: 1 });
      if (logo) {
        const sh = logo.querySelector<HTMLElement>(".lr-sheen")!;
        tl.fn(tc + 1.05, 1.3, (q) => (sh.style.backgroundPosition = `${(100 - 100 * q).toFixed(2)}% 0`), { ease: "smooth", key: "cta-sheen" });
      }
    } else {
      tl.emit("final", Math.min(ctx.end - 3, tB + 1.2));
    }
  },
};
