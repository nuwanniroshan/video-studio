export type Ease = (p: number) => number;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Cubic-bezier solver (Newton, then bisection fallback). Ported verbatim from the prototype. */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export const ease = {
  linear: (p: number) => p,
  /** House default: confident, settles softly. */
  out: bezier(0.16, 1, 0.3, 1),
  in: bezier(0.7, 0, 0.84, 0),
  /** Strong camera move. */
  inOut: bezier(0.83, 0, 0.17, 1),
  /** Cursor moves and lines. */
  smooth: bezier(0.45, 0, 0.2, 1),
  soft: bezier(0.25, 0.1, 0.25, 1),
  back: (p: number) => {
    const c1 = 1.4, c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  },
  /** Drops. */
  spring: (p: number) => (p >= 1 ? 1 : 1 - Math.exp(-6.5 * p) * Math.cos(p * Math.PI * 2.6)),
} satisfies Record<string, Ease>;

export type EaseName = keyof typeof ease;
export type EaseLike = Ease | EaseName;
export const toEase = (e: EaseLike | undefined, def: Ease = ease.out): Ease =>
  e === undefined ? def : typeof e === "function" ? e : ease[e];
