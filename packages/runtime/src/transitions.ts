/*
 * Transitions (PLAN §7.3): each overlaps the cut symmetrically, [start, end], centre = cut.
 * They animate the scene roots on the root timeline in absolute time and emit an SFX marker.
 */
import type { Scope } from "@vs/engine";

export interface TransitionCtx { tl: Scope; out: HTMLElement; inn: HTMLElement; start: number; end: number; direction?: string; stage: { w: number; h: number }; flash: HTMLElement }

/** When each root is visible around the cut: [outUntil) for the outgoing, [inFrom, …) for the incoming. */
export function visibility(type: string, start: number, end: number) {
  const c = (start + end) / 2;
  if (type === "cut" || type === "flash") return { outUntil: c, inFrom: c };
  return { outUntil: end, inFrom: start };
}

export function applyTransition(type: string, x: TransitionCtx) {
  const { tl, out, inn, start, end } = x;
  const d = end - start, c = (start + end) / 2;
  switch (type) {
    case "cut":
      return;
    case "crossfade":
      tl.tw(inn, start, d, { o: 0 }, { o: 1 }, "soft");
      tl.emit("whoosh", start, { gain: 0.3 });
      return;
    case "push": {
      const dir = x.direction ?? "left";
      const ax = dir === "left" || dir === "right" ? "x" : "y";
      const sign = dir === "left" || dir === "up" ? 1 : -1;
      const dist = (ax === "x" ? x.stage.w : x.stage.h) * sign;
      tl.tw(inn, start, d, { [ax]: dist }, { [ax]: 0 }, "inOut");
      tl.tw(out, start, d, { [ax]: 0 }, { [ax]: -dist }, "inOut");
      tl.emit("whoosh", start, { gain: 0.45 });
      return;
    }
    case "iris":
      inn.style.setProperty("--cx", "50%");
      inn.style.setProperty("--cy", "46%");
      tl.tw(inn, start, d, { clipR: 0 }, { clipR: 145 }, "inOut");
      tl.emit("whoosh", start, { gain: 0.5 });
      return;
    case "flash": {
      // white flash peaking at the cut: fast in, slow out (prototype 14.86–15.9 s)
      const rise = Math.min(0.14, d / 2);
      tl.tw(x.flash, c - rise, rise, { o: 0 }, { o: 1 }, "in");
      tl.tw(x.flash, c, Math.max(0.2, end - c), { o: 1 }, { o: 0 }, "out");
      tl.emit("impact", c, { transition: true });
      return;
    }
    default:
      throw new Error(`unknown transition "${type}"`);
  }
}
