/*
 * House-style motions (REFERENCE §3), ported from the prototype's scenes.js helpers.
 * Each takes a scoped timeline and local times; distances are in stage px scaled by `u`
 * (stage-unit scale = min(stageW, stageH) / 1080) so motion reads the same in every aspect.
 */
import type { Scope } from "@vs/engine";

export const unit = (stage: { w: number; h: number }) => Math.min(stage.w, stage.h) / 1080;

export function copyIn(tl: Scope, parts: { kicker?: Element | null; h1?: Element | null; sub?: Element | null }, t: number, u = 1) {
  if (parts.kicker) tl.from(parts.kicker, t, 0.7, { y: 16 * u, o: 0 });
  if (parts.h1) tl.revealWords(parts.h1, t + 0.12, 0.055, 0.9, 44 * u);
  if (parts.sub) tl.from(parts.sub, t + 0.55, 0.9, { y: 18 * u, o: 0, blur: 5 });
}
export const copyOut = (tl: Scope, el: Element, t: number, u = 1) => tl.to(el, t, 0.42, { y: -30 * u, o: 0, blur: 6 }, "in");
export const paneIn = (tl: Scope, el: Element, t: number, u = 1) => tl.from(el, t, 0.85, { y: 46 * u, o: 0, blur: 6 });
export const paneOut = (tl: Scope, el: Element, t: number, u = 1) => tl.to(el, t, 0.42, { y: -36 * u, o: 0, blur: 6 }, "in");
export const pop = (tl: Scope, el: Element, t: number, d = 0.5, s = 0.4) => tl.from(el, t, d, { s, o: 0 }, "back");
export function press(tl: Scope, el: Element, t: number) {
  tl.tw(el, t, 0.08, null, { s: 0.95 }, "out").tw(el, t + 0.09, 0.35, null, { s: 1 }, "out");
}
export function click(tl: Scope, cur: Element, rip: Element | null, t: number) {
  tl.tw(cur, t, 0.08, null, { s: 0.82 }, "out").tw(cur, t + 0.1, 0.25, null, { s: 1 }, "out");
  if (rip) tl.hide(rip).tw(rip, t, 0.6, { s: 0.3, o: 0.9 }, { s: 1.6, o: 0 }, "out");
  tl.emit("click", t);
}
export function curShow(tl: Scope, cur: Element, t: number, x: number, y: number) {
  tl.hide(cur).set(cur, t - 0.02, { x, y }).to(cur, t, 0.3, { o: 1 }, "out");
}
export const curMove = (tl: Scope, cur: Element, t: number, d: number, x: number, y: number) => tl.to(cur, t, d, { x, y }, "smooth");
export const curHide = (tl: Scope, cur: Element, t: number) => tl.to(cur, t, 0.3, { o: 0 }, "out");
export function sweep(tl: Scope, el: HTMLElement, t0: number, d: number, key: string) {
  tl.fn(t0, d, (p) => (el.style.backgroundPosition = `${100 - 100 * p}% 0`), { ease: "smooth", key });
}
/** Box of `el` relative to `ref`. Call during mount, before the first seek (pitfall 6). */
export function rel(el: Element, ref: Element) {
  const a = el.getBoundingClientRect(), b = ref.getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height, cx: a.left - b.left + a.width / 2, cy: a.top - b.top + a.height / 2 };
}
