import type { z } from "zod";
import type { screenFlow as def } from "@vs/spec";
import type { SceneModule } from "./types.ts";
import { animateBackground, background, browserFrame, copyBlock, copyIn, copyOut, cursor, exitTime, rel, startTime, unit } from "./parts.ts";
import { h } from "./text.ts";

type P = z.output<typeof def.schema>;
interface Geo { cam: { w: number; h: number }; view: { x: number; y: number; w: number; h: number } }

export const screenFlow: SceneModule<P> = {
  type: "screenFlow",
  version: 1,
  meta: { label: "Screen flow", category: "product", description: "", defaultMusicCue: "groove" },
  async mount(root, p, ctx) {
    background(root, ctx.tone);
    const wrap = h("div", `sf sf-${ctx.orient}`);
    if (p.kicker || p.title) wrap.append(copyBlock({ kicker: p.kicker, headline: p.title }, "sf-copy copy", "vs-h2").wrap);
    const camBox = h("div", "sf-cambox");
    const cam = h("div", "sf-cam");
    const { frame, view } = browserFrame(ctx.brand.ctaUrl);
    const imgs = p.steps.map((s) => { const im = h("img", "sf-shot"); im.src = ctx.url(s.screen); view.append(im); return im; });
    cam.append(frame);
    camBox.append(cam);
    wrap.append(camBox);
    const caps = h("div", "sf-caps");
    p.steps.forEach((s) => { const c = h("div", "sf-cap vs-text"); c.textContent = s.caption ?? ""; if (!s.caption) c.classList.add("empty"); caps.append(c); });
    wrap.append(caps);
    root.append(wrap);
    // size the frame to the screenshot's aspect inside the available box
    await imgs[0].decode().catch(() => undefined);
    const ar = imgs[0].naturalWidth && imgs[0].naturalHeight ? imgs[0].naturalWidth / imgs[0].naturalHeight : 16 / 10;
    const box = camBox.getBoundingClientRect();
    const barH = frame.querySelector(".browser-bar")!.getBoundingClientRect().height;
    let w = box.width, hh = w / ar + barH;
    if (hh > box.height) { hh = box.height; w = (hh - barH) * ar; }
    frame.style.width = w + "px";
    frame.style.height = hh + "px";
    p.steps.forEach((s, i) => {
      if (s.type && s.click) {
        const ty = h("div", "sf-typed"); ty.dataset.step = String(i);
        ty.style.left = s.click.x * 100 + "%"; ty.style.top = s.click.y * 100 + "%";
        view.append(ty);
      }
    });
    cursor(cam);
    const geo: Geo = { cam: { w: cam.getBoundingClientRect().width, h: cam.getBoundingClientRect().height }, view: rel(view, cam) };
    root.dataset.geo = JSON.stringify(geo);
  },
  animate(tl, p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    animateBackground(tl, root, ctx);
    const geo = JSON.parse(root.dataset.geo!) as Geo;
    const t = startTime(ctx);
    const copy = root.querySelector<HTMLElement>(".sf-copy");
    if (copy) copyIn(tl, { wrap: copy, kicker: copy.querySelector<HTMLElement>(".vs-kicker") ?? undefined, h1: copy.querySelector<HTMLElement>(".vs-h2") ?? undefined }, t, u);
    const cam = root.querySelector<HTMLElement>(".sf-cam")!;
    const frame = root.querySelector<HTMLElement>(".browser")!;
    tl.tw(frame, t + 0.1, 1.2, { y: 120 * u, s: 0.94, o: 0, blur: 6 }, { y: 0, s: 1, o: 1, blur: 0 }, "out");
    tl.emit("whoosh", t + 0.1, { gain: 0.35 });
    const shots = [...root.querySelectorAll<HTMLElement>(".sf-shot")];
    const caps = [...root.querySelectorAll<HTMLElement>(".sf-cap")];
    const { cur, rip } = { cur: root.querySelector<HTMLElement>(".cursor")!, rip: root.querySelector<HTMLElement>(".ripple")! };
    tl.hide(cur).hide(rip);
    const steps = p.steps.map((_, i) => ctx.steps[i] ?? { start: t + i * 2, end: t + (i + 1) * 2 });
    const pt = (q: { x: number; y: number }) => ({ x: geo.view.x + q.x * geo.view.w, y: geo.view.y + q.y * geo.view.h });
    const zoomed = ctx.orient !== "landscape";
    let curShown = false;
    p.steps.forEach((s, i) => {
      const st = Math.max(steps[i].start, t + 0.2), en = steps[i].end;
      if (i > 0) { tl.hide(shots[i]).to(shots[i], st - 0.15, 0.35, { o: 1 }, "soft"); tl.emit("whoosh", st - 0.15, { gain: 0.2 }); }
      if (s.caption) {
        tl.hide(caps[i]).tw(caps[i], st + 0.1, 0.5, { y: 14 * u, o: 0 }, { y: 0, o: 1 });
        if (i < p.steps.length - 1) tl.to(caps[i], steps[i + 1].start - 0.2, 0.3, { o: 0 }, "in");
      }
      // focus camera: portrait/square zoom to the step's focus rect; landscape stays wide
      if (zoomed) {
        const f = s.focus ?? { x: 0, y: 0, w: 1, h: 1 };
        const fw = f.w * geo.view.w, fh = f.h * geo.view.h;
        const sc = Math.max(1, Math.min(2.4, (geo.cam.w * 0.96) / fw, (geo.cam.h * 0.9) / fh));
        const fc = { x: geo.view.x + (f.x + f.w / 2) * geo.view.w, y: geo.view.y + (f.y + f.h / 2) * geo.view.h };
        const c = { x: geo.cam.w / 2, y: geo.cam.h / 2 };
        let x = -(fc.x - c.x) * sc, y = -(fc.y - c.y) * sc;
        // keep the frame covering the camera box
        const maxX = ((sc - 1) * geo.cam.w) / 2, maxY = Math.max(0, ((sc - 1) * geo.cam.h) / 2);
        x = Math.max(-maxX, Math.min(maxX, x)); y = Math.max(-maxY, Math.min(maxY, y));
        tl.to(cam, i === 0 ? st + 0.9 : st - 0.1, 0.9, { x, y, s: sc }, "inOut");
      }
      if (s.click) {
        const tc = Math.min(en - 0.45, st + 1.35);
        const p0 = pt(s.click);
        if (!curShown) { tl.set(cur, tc - 1.3, { x: p0.x + 160 * u, y: p0.y + 140 * u }).to(cur, tc - 1.28, 0.3, { o: 1 }); curShown = true; }
        tl.to(cur, tc - 0.95, 0.75, { x: p0.x - 4 * u, y: p0.y - 3 * u }, "smooth");
        tl.tw(cur, tc, 0.08, null, { s: 0.82 }).tw(cur, tc + 0.1, 0.25, null, { s: 1 });
        rip.style.left = "0px"; rip.style.top = "0px";
        tl.set(rip, tc - 0.01, { x: p0.x, y: p0.y }).tw(rip, tc, 0.6, { s: 0.3, o: 0.9 }, { s: 1.6, o: 0 });
        tl.emit("click", tc);
        const typed = root.querySelector<HTMLElement>(`.sf-typed[data-step="${i}"]`);
        if (typed && s.type) {
          const d = Math.min(1.6, 0.05 * s.type.length);
          tl.hide(typed).to(typed, tc + 0.1, 0.2, { o: 1 });
          tl.type(typed, tc + 0.15, d, s.type);
          for (let k = 0; k < s.type.length; k += 2) tl.emit("type", tc + 0.15 + (k / s.type.length) * d, { gain: 0.4 });
        }
      }
    });
    if (curShown) {
      // leave at the first later step without a click (nothing to point at), else just before the end
      const idle = p.steps.findIndex((s, i) => i > 0 && !s.click && p.steps.slice(0, i).some((x) => x.click));
      const tHide = idle > 0 ? Math.max(steps[idle].start, t + 0.2) + 0.1 : Math.min(ctx.end - 0.4, steps.at(-1)!.end - 0.4);
      tl.to(cur, tHide, 0.3, { o: 0 });
    }
    const x = exitTime(ctx);
    if (x !== null) {
      if (copy) copyOut(tl, copy, x, u);
      tl.to(frame, x, 0.42, { y: -36 * u, o: 0, blur: 6 }, "in");
      tl.to(root.querySelector(".sf-caps")!, x, 0.3, { o: 0 }, "in");
    }
  },
};
