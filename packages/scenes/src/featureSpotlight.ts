import type { z } from "zod";
import type { featureSpotlight as def } from "@vs/spec";
import type { SceneModule } from "./types.ts";
import { animateBackground, background, browserFrame, copyBlock, copyIn, copyOut, cursor, exitTime, fitHeadline, rel, startTime, unit } from "./parts.ts";
import { h } from "./text.ts";
import { iconSvg } from "./icons.ts";

type P = z.output<typeof def.schema>;
const STATUS: Record<string, string> = { ok: "green", warn: "amber", info: "blue", new: "violet" };
const STATUS_LABEL: Record<string, string> = { ok: "Done", warn: "Check", info: "Info", new: "New" };

export const featureSpotlight: SceneModule<P> = {
  type: "featureSpotlight",
  version: 1,
  meta: { label: "Feature spotlight", category: "feature", description: "", defaultMusicCue: "groove" },
  mount(root, p, ctx) {
    background(root, ctx.tone);
    const layout = p.layout === "auto" ? (ctx.orient === "landscape" ? "split-left" : "stacked") : p.layout;
    const wrap = h("div", `fs fs-${layout}`);
    if (layout !== "visual-only") {
      const c = copyBlock({ kicker: p.kicker, headline: p.headline, body: p.body }, "fs-copy copy");
      if (p.bullets?.length) {
        const ul = h("ul", "fs-bullets");
        for (const b of p.bullets) {
          const li = h("li", "vs-text");
          li.innerHTML = iconSvg("check") + `<span></span>`;
          li.querySelector("span")!.textContent = b;
          ul.append(li);
        }
        c.wrap.append(ul);
      }
      wrap.append(c.wrap);
    }
    const stageEl = h("div", "fs-visual");
    const tilt = h("div", "fs-tilt");
    if (p.visual.kind === "image") {
      if (p.visual.frame === "browser") {
        const { frame, view } = browserFrame(ctx.brand.ctaUrl);
        const img = h("img", "fs-img");
        img.src = ctx.url(p.visual.asset);
        view.append(img);
        tilt.append(frame);
      } else {
        const img = h("img", "fs-img fs-img-bare");
        img.src = ctx.url(p.visual.asset);
        tilt.append(img);
      }
    } else {
      const panel = h("div", "panel");
      const head = h("div", "panel-head");
      const title = h("div", "card-h vs-text");
      title.textContent = p.visual.title;
      head.append(title, h("span", "chip blue", "Live"));
      panel.append(head);
      const rows = h("div", "panel-rows");
      for (const r of p.visual.rows) {
        const row = h("div", "panel-row");
        const l = h("span", "panel-label vs-text"); l.textContent = r.label;
        row.append(l);
        const right = h("span", "panel-right");
        if (r.value) { const v = h("span", "panel-value vs-text"); v.textContent = r.value; right.append(v); }
        if (r.status !== "none") right.append(h("span", `chip ${STATUS[r.status]}`, STATUS_LABEL[r.status]));
        row.append(right);
        rows.append(row);
      }
      panel.append(rows);
      if (p.visual.action) {
        const foot = h("div", "panel-foot");
        const btn = h("span", "btn primary vs-text"); btn.textContent = p.visual.action;
        foot.append(btn);
        panel.append(foot);
      }
      tilt.append(panel);
    }
    stageEl.append(tilt);
    wrap.append(stageEl);
    root.append(wrap);
    if (p.visual.kind === "panel" && p.visual.action) cursor(root);
    fitHeadline(ctx, wrap.querySelector<HTMLElement>(".vs-h1") ?? undefined, layout === "stacked" ? 92 : 80, 40, layout === "stacked" ? 0.2 : 0.3);
    // measure the button before any seek (pitfall 6)
    const btn = root.querySelector(".panel-foot .btn");
    if (btn) root.dataset.btn = JSON.stringify(rel(btn, root));
  },
  animate(tl, p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    animateBackground(tl, root, ctx);
    const t = startTime(ctx);
    const copy = root.querySelector<HTMLElement>(".fs-copy");
    if (copy) {
      copyIn(tl, { wrap: copy, kicker: copy.querySelector<HTMLElement>(".vs-kicker") ?? undefined, h1: copy.querySelector<HTMLElement>(".vs-h1") ?? undefined, body: copy.querySelector<HTMLElement>(".vs-sub") ?? undefined }, t, u);
      tl.stagger(copy.querySelectorAll(".fs-bullets li"), t + 0.9, 0.12, 0.7, { x: -14 * u, o: 0 });
    }
    const tilt = root.querySelector<HTMLElement>(".fs-tilt")!;
    const portrait = ctx.orient !== "landscape";
    // frame entry, then the rest pose with a gentle sway (REFERENCE §3 app frame)
    tl.tw(tilt, t + 0.1, 1.4, { y: 340 * u, x: portrait ? 0 : 60 * u, rx: 26, ry: portrait ? -8 : -22, s: 0.9, o: 0 },
      { y: 0, x: 0, rx: 2, ry: portrait ? -2 : -5, s: 1, o: 1 }, "out");
    const swayEnd = ctx.end + (ctx.outT ? ctx.outT.end - ctx.end : 0);
    tl.to(tilt, t + 1.5, Math.max(0.5, swayEnd - t - 1.5), { rx: 1.2, ry: portrait ? -1 : -3.2 }, "soft");
    tl.emit("whoosh", t + 0.1, { gain: 0.4 });
    const rows = root.querySelectorAll(".panel-row");
    if (rows.length) {
      tl.stagger(rows, t + 0.7, 0.08, 0.8, { y: 30 * u, o: 0 });
      root.querySelectorAll(".panel-row .chip").forEach((c, i) => {
        tl.from(c, t + 1.1 + i * 0.1, 0.5, { s: 0.4, o: 0 }, "back");
        tl.emit("pop", t + 1.1 + i * 0.1, { gain: 0.25 });
      });
    }
    const foot = root.querySelector(".panel-foot");
    if (foot) tl.from(foot, t + 0.9 + rows.length * 0.08, 0.7, { y: 20 * u, o: 0 });
    // cursor clicks the action button late in the scene
    const cur = root.querySelector<HTMLElement>(".cursor"), rip = root.querySelector<HTMLElement>(".ripple");
    if (cur && rip && root.dataset.btn) {
      const b = JSON.parse(root.dataset.btn);
      const tc = Math.max(t + 2.4, Math.min(ctx.end - 1.0, (ctx.vo.at(-1)?.t ?? t + 2) + 0.6));
      rip.style.left = b.cx + "px"; rip.style.top = b.cy + "px";
      tl.hide(cur).set(cur, tc - 1.2, { x: b.cx + 220 * u, y: b.cy + 200 * u }).to(cur, tc - 1.18, 0.3, { o: 1 });
      tl.to(cur, tc - 1.0, 0.8, { x: b.cx - 6 * u, y: b.cy - 4 * u }, "smooth");
      tl.tw(cur, tc, 0.08, null, { s: 0.82 }).tw(cur, tc + 0.1, 0.25, null, { s: 1 });
      tl.hide(rip).tw(rip, tc, 0.6, { s: 0.3, o: 0.9 }, { s: 1.6, o: 0 });
      const btn = root.querySelector(".panel-foot .btn")!;
      tl.tw(btn, tc, 0.08, null, { s: 0.95 }).tw(btn, tc + 0.09, 0.35, null, { s: 1 });
      tl.emit("click", tc);
      tl.emit("chime", tc + 0.15, { gain: 0.6 });
      tl.to(cur, tc + 0.5, 0.3, { o: 0 });
    }
    const x = exitTime(ctx);
    if (x !== null) {
      if (copy) copyOut(tl, copy, x, u);
      tl.to(tilt, x, 0.42, { y: -36 * u, o: 0, blur: 6 }, "in");
    }
  },
};
