import { describe, expect, it } from "vitest";
import type { RuntimeDoc, RuntimeScene } from "@vs/runtime";
import type { ResolvedTimeline } from "@vs/timing";
import { QUALITY, captions, planSegments } from "../src/index.ts";

const sc = (id: string, start: number, end: number, extra: Partial<RuntimeScene> = {}): RuntimeScene => ({
  id, type: "kineticTitle", start, end, tone: "light", props: { headline: id }, vo: [{ id: "v1", t: start + 0.45, dur: 1 }],
  steps: [{ start, end }], cues: {}, transitionIn: null, ...extra,
});
const doc = (scenes: RuntimeScene[]): RuntimeDoc => ({
  aspect: "16:9", width: 1920, height: 1080, fps: 60, duration: scenes[scenes.length - 1].end,
  brandCss: "", brandBase: "", scenes,
});
const tr = (type: string, c: number, d: number) => ({ type, start: c - d / 2, end: c + d / 2 });
const ctx = { runtime: "r", brand: "b" };
const q = QUALITY.standard;

const base = () => doc([
  sc("a", 0, 5),
  sc("b", 5, 12.5, { transitionIn: tr("crossfade", 5, 0.6) }),
  sc("c", 12.5, 17.5, { transitionIn: tr("flash", 12.5, 0.9) }),
  sc("d", 17.5, 22.5, { transitionIn: tr("cut", 17.5, 0) }),
]);

describe("planSegments", () => {
  it("covers every frame exactly once, frame-aligned, slices ≤ MAX_SLICE", () => {
    const s = planSegments(base(), q, ctx);
    expect(s[0].f0).toBe(0);
    expect(s.at(-1)!.f1).toBe(22.5 * 30);
    for (let i = 1; i < s.length; i++) expect(s[i].f0).toBe(s[i - 1].f1);
    for (const x of s) expect(x.f1 - x.f0).toBeLessThanOrEqual(2 * 30);
    expect(s.filter((x) => x.kind === "transition").map((x) => x.scenes)).toEqual([["a", "b"], ["b", "c"]]);
  });

  it("editing one scene's props changes only its segments and adjacent transitions", () => {
    const a = planSegments(base(), q, ctx);
    const d2 = base();
    d2.scenes[1].props = { headline: "changed" };
    const b = planSegments(d2, q, ctx);
    const changed = b.filter((s, i) => s.key !== a[i].key);
    expect(changed.length).toBeGreaterThan(0);
    for (const s of changed) expect(s.scenes).toContain("b");
    expect(b.filter((s) => !s.scenes.includes("b")).every((s) => a.some((x) => x.key === s.key))).toBe(true);
  });

  it("keys are scene-local: lengthening an earlier scene keeps later scenes' keys", () => {
    const a = planSegments(base(), q, ctx);
    const shifted = doc([
      sc("a", 0, 7.5),
      ...base().scenes.slice(1).map((s) => ({ ...s, start: s.start + 2.5, end: s.end + 2.5, vo: s.vo.map((v) => ({ ...v, t: v.t + 2.5 })),
        steps: s.steps.map((x) => ({ start: x.start + 2.5, end: x.end + 2.5 })), transitionIn: s.transitionIn && { ...s.transitionIn, start: s.transitionIn.start + 2.5, end: s.transitionIn.end + 2.5 } })),
    ]);
    const b = planSegments(shifted, q, ctx);
    const keysOf = (segs: typeof a, id: string) => segs.filter((s) => s.scenes.length === 1 && s.scenes[0] === id).map((s) => s.key);
    for (const id of ["c", "d"]) expect(keysOf(b, id)).toEqual(keysOf(a, id));
    expect(keysOf(b, "a")).not.toEqual(keysOf(a, "a"));
  });

  it("quality and runtime changes invalidate everything", () => {
    const a = planSegments(base(), q, ctx), b = planSegments(base(), q, { ...ctx, runtime: "r2" });
    expect(b.every((s, i) => s.key !== a[i].key)).toBe(true);
  });
});

describe("captions", () => {
  it("SRT/VTT from VO timings, clamped before the next line", () => {
    const r = { duration: 6, scenes: [{ vo: [{ id: "v1", text: "Hello there.", t: 0.45, dur: 1.2 }, { id: "v2", text: "Next.", t: 1.8, dur: 0.6 }] }] } as unknown as ResolvedTimeline;
    const c = captions(r);
    expect(c.srt).toContain("1\n00:00:00,450 --> 00:00:01,800\nHello there.");
    expect(c.vtt.startsWith("WEBVTT")).toBe(true);
    expect(c.vtt).toContain("00:00:01.800 --> 00:00:02.650\nNext.");
  });
});
