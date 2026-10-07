/** Shared DOM building blocks (house style, REFERENCE §3). */
import type { Scope } from "@vs/engine";
import type { AnimCtx, MountCtx } from "./types.ts";
import { h, richText } from "./text.ts";
import { cursorSvg } from "./icons.ts";

export const unit = (stage: { w: number; h: number }) => Math.min(stage.w, stage.h) / 1080;

/** Per-scene background for its tone; orbs drift on the scene's own clock. */
export function background(root: HTMLElement, tone: string) {
  const bg = h("div", `bg bg-${tone}`);
  if (tone === "light") bg.innerHTML = '<div class="grid grid-light"></div><div class="orb orb-a"></div><div class="orb orb-b"></div><div class="vignette-light"></div>';
  else bg.innerHTML = `<div class="grid grid-dark"></div>`;
  root.prepend(bg);
  return bg;
}
export function animateBackground(tl: Scope, root: HTMLElement, ctx: AnimCtx) {
  if (ctx.tone !== "light") return;
  const a = root.querySelector<HTMLElement>(".orb-a"), b = root.querySelector<HTMLElement>(".orb-b");
  if (!a || !b) return;
  const u = unit(ctx.stage);
  const from = ctx.inT ? ctx.inT.start : 0, to = ctx.outT ? ctx.outT.end : ctx.end;
  tl.fn(from, to - from, (_p, t) => {
    a.style.transform = `translate(${(Math.sin(t * 0.21) * 60 * u).toFixed(2)}px,${(Math.cos(t * 0.17) * 40 * u).toFixed(2)}px)`;
    b.style.transform = `translate(${(Math.cos(t * 0.19) * 70 * u).toFixed(2)}px,${(Math.sin(t * 0.23) * 40 * u).toFixed(2)}px)`;
  }, { ease: "linear", continuous: true });
}

export interface CopyParts { wrap: HTMLElement; kicker?: HTMLElement; h1?: HTMLElement; body?: HTMLElement }
export function copyBlock(p: { kicker?: string; headline?: string; body?: string }, cls = "copy", h1cls = "vs-h1"): CopyParts {
  const wrap = h("div", cls);
  const parts: CopyParts = { wrap };
  if (p.kicker) {
    parts.kicker = h("div", "vs-kicker");
    parts.kicker.append(h("span", "bar"), h("span", "label vs-text", richText(p.kicker)));
    wrap.append(parts.kicker);
  }
  if (p.headline) { parts.h1 = h("h2", `${h1cls} vs-text`, richText(p.headline)); parts.h1.dataset.fit = "h1"; wrap.append(parts.h1); }
  if (p.body) { parts.body = h("p", "vs-sub vs-text", richText(p.body)); wrap.append(parts.body); }
  return parts;
}
export function copyIn(tl: Scope, c: CopyParts, t: number, u: number) {
  if (c.kicker) {
    tl.from(c.kicker, t, 0.7, { y: 16 * u, o: 0 });
    tl.tw(c.kicker.querySelector(".bar")!, t + 0.1, 0.7, { sx: 0 }, { sx: 1 }, "out");
  }
  if (c.h1) tl.revealWords(c.h1, t + 0.12, 0.055, 0.9, 44 * u);
  if (c.body) tl.from(c.body, t + 0.55, 0.9, { y: 18 * u, o: 0, blur: 5 });
}
export const copyOut = (tl: Scope, el: Element, t: number, u: number) => tl.to(el, t, 0.42, { y: -30 * u, o: 0, blur: 6 }, "in");

/** Fit a headline between bounds scaled to the stage. */
export function fitHeadline(ctx: MountCtx, el: HTMLElement | undefined, maxPx: number, minPx = 40, maxHeightFrac = 0.34) {
  if (!el) return;
  const u = unit(ctx.stage);
  ctx.fitText(el, { min: minPx * u, max: maxPx * u, maxHeight: ctx.stage.h * maxHeightFrac });
}

export function browserFrame(url = "app.example.com") {
  const f = h("div", "browser");
  f.innerHTML = `<div class="browser-bar"><i></i><i></i><i></i><span class="browser-url">${url.replace(/[<>&]/g, "")}</span></div><div class="browser-view"></div>`;
  return { frame: f, view: f.querySelector<HTMLElement>(".browser-view")! };
}

export function cursor(parent: HTMLElement) {
  const c = h("div", "cursor", cursorSvg());
  const r = h("div", "ripple");
  parent.append(r, c);
  return { cur: c, rip: r };
}

/** Local time the visuals should start: slightly ahead of the first VO line, after any transition-in. */
export function startTime(ctx: AnimCtx, lead = 0.3) {
  const afterIn = ctx.inT ? Math.max(0, ctx.inT.end - 0.2) : 0.15;
  return ctx.vo[0] ? Math.max(afterIn, ctx.vo[0].t - lead) : Math.max(afterIn, 0.25);
}
/** Local time to start an exit animation, or null when a real transition carries the scene out. */
export function exitTime(ctx: AnimCtx, d = 0.55): number | null {
  if (ctx.outT && ctx.outT.end - ctx.outT.start > 0.05) return null;
  return ctx.end - d;
}

export function rel(el: Element, ref: Element) {
  const a = el.getBoundingClientRect(), b = ref.getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height, cx: a.left - b.left + a.width / 2, cy: a.top - b.top + a.height / 2 };
}
