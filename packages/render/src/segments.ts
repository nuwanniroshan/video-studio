/*
 * Segment planning (PLAN §10.4). Units: a scene body, a transition window, or a ≤ 6 s slice.
 * Boundaries are frame-aligned at the tier fps. A segment's cache key covers everything that can
 * change its pixels: runtime build, brand, quality, aspect, the scenes it shows (type@version,
 * resolved props with asset hashes, tone, scene-local cues/VO/steps/transition windows) and its
 * frame range in scene-local time.
 */
import type { RuntimeDoc, RuntimeScene } from "@vs/runtime";
import { hashJson } from "@vs/storage";
import { catalog } from "@vs/spec";
import type { QualityTier } from "./quality.ts";

export interface Segment {
  index: number; kind: "body" | "transition";
  /** Scene ids that must be mounted. */
  scenes: string[];
  /** Frames [f0, f1) at the tier fps, absolute. */
  f0: number; f1: number;
  key: string;
}

const MAX_SLICE = 6;

/** Everything about a scene that its pixels depend on, in scene-local time. */
function sceneFingerprint(doc: RuntimeDoc, i: number) {
  const s = doc.scenes[i], next = doc.scenes[i + 1];
  const L = (t: number) => Math.round((t - s.start) * 1e6) / 1e6;
  return {
    id: s.id, type: s.type, version: catalog[s.type]?.version ?? 0, tone: s.tone, props: s.props,
    len: L(s.end), vo: s.vo.map((v) => ({ ...v, t: L(v.t) })), steps: s.steps.map((x) => [L(x.start), L(x.end)]),
    in: s.transitionIn ? { type: s.transitionIn.type, a: L(s.transitionIn.start), b: L(s.transitionIn.end), dir: s.transitionIn.direction } : null,
    out: next?.transitionIn ? { type: next.transitionIn.type, a: L(next.transitionIn.start), b: L(next.transitionIn.end) } : null,
    last: i === doc.scenes.length - 1,
  };
}

export function planSegments(doc: RuntimeDoc, q: QualityTier, ctx: { runtime: string; brand: string }): Segment[] {
  const fps = q.fps;
  const F = (t: number) => Math.round(t * fps);
  const total = F(doc.duration);
  const out: Omit<Segment, "index" | "key">[] = [];
  doc.scenes.forEach((s, i) => {
    const next = doc.scenes[i + 1];
    const inEnd = s.transitionIn && s.transitionIn.type !== "cut" ? F(s.transitionIn.end) : F(s.start);
    const outStart = next?.transitionIn && next.transitionIn.type !== "cut" ? F(next.transitionIn.start) : F(s.end);
    // body, sliced
    for (let a = inEnd; a < outStart; ) {
      const n = Math.ceil((outStart - a) / (MAX_SLICE * fps));
      const b = n <= 1 ? outStart : a + Math.ceil((outStart - a) / n);
      out.push({ kind: "body", scenes: [s.id], f0: a, f1: b });
      a = b;
    }
    if (next?.transitionIn && next.transitionIn.type !== "cut") {
      out.push({ kind: "transition", scenes: [s.id, next.id], f0: F(next.transitionIn.start), f1: F(next.transitionIn.end) });
    }
  });
  const segs = out.filter((s) => s.f1 > s.f0);
  // sanity: contiguous cover of [0, total)
  let c = 0;
  for (const s of segs) { if (s.f0 !== c) throw new Error(`segment gap at frame ${c}`); c = s.f1; }
  if (c !== total) throw new Error(`segments end at ${c}, expected ${total}`);
  return segs.map((s, index) => {
    const first = doc.scenes.find((x) => x.id === s.scenes[0])!;
    // frame range in the first scene's local time (exact: start * fps phase included)
    const local = { a: (s.f0 - first.start * fps), b: (s.f1 - first.start * fps) };
    const key = hashJson({
      v: 2, runtime: ctx.runtime, brand: ctx.brand, q, w: doc.width, h: doc.height, aspect: doc.aspect,
      kind: s.kind, local: [Math.round(local.a * 1e4) / 1e4, Math.round(local.b * 1e4) / 1e4],
      scenes: s.scenes.map((id) => sceneFingerprint(doc, doc.scenes.findIndex((x) => x.id === id))),
    });
    return { ...s, index, key };
  });
}

export const sceneById = (doc: RuntimeDoc, id: string): RuntimeScene => doc.scenes.find((s) => s.id === id)!;
