import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SCENE_DEFS, validateSpec, type Spec } from "@vs/spec";
import { TimingError, resolve } from "../src/index.ts";

const spec = (raw: unknown): Spec => {
  const r = validateSpec(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.spec;
};
const base = { version: 1, title: "t", brand: "luraplus" };
/** VO duration = 0.4 s per word (a stand-in for TTS). */
const words = (_s: string, l: { text: string }) => 0.4 * l.text.split(/\s+/).length;

describe("resolve: examples", () => {
  const s = spec({ ...base, scenes: [
    { id: "hook", type: "kineticTitle", props: { headline: "Hi" }, vo: [{ text: "one two three four five" }] },
    { id: "grid", type: "featureGrid", transitionIn: { type: "crossfade" }, props: SCENE_DEFS[3].example,
      vo: [{ text: "first item", step: 0 }, { text: "second item is longer here", step: 1 }, { text: "third", step: 2 }] },
    { id: "cta", type: "ctaEndCard", props: { headline: "Go", button: "Demo" } },
  ] });
  const r = resolve(s, "main", words, { bpm: 96 });

  it("snaps scene ends up to the bar (2.5 s at 96 BPM)", () => {
    // hook 0.45 + 2.0 + 0.6 → 5; grid 0.45 + (1.15 + 2.35 + 0.8) + 0.6 = 5.35 → 12.5; cta min 6 → 20
    expect(r.scenes.map((x) => [x.start, x.end])).toEqual([[0, 5], [5, 12.5], [12.5, 20]]);
    expect(r.duration).toBe(20);
  });
  it("places VO at leadIn then prev.end + lineGap", () => {
    expect(r.scenes[0].vo[0]).toMatchObject({ id: "v1", t: 0.45, dur: 2 });
  });
  it("binds VO lines to steps and exposes cues", () => {
    const g = r.scenes[1];
    expect(g.steps).toHaveLength(3);
    g.vo.forEach((v, i) => expect(v.t).toBeCloseTo(g.steps[i].start, 6));
    expect(g.cues["vo.v2"]).toBe(g.vo[1].t);
    expect(g.cues["step.2"]).toBe(g.steps[2].start);
    expect(g.steps[2].end).toBeCloseTo(g.end - 0.6, 6); // last step ends one tail before the cut
  });
  it("overlaps transitions symmetrically around the cut", () => {
    expect(r.scenes[1].transitionIn).toEqual({ type: "crossfade", start: 4.7, end: 5.3 });
    expect(r.scenes[2].transitionIn?.type).toBe("iris"); // ctaEndCard's module default
    expect(r.scenes[0].transitionIn).toBeNull();
  });
  it("is deterministic", () => {
    expect(resolve(s, "main", words, { bpm: 96 })).toEqual(r);
  });
});

describe("resolve: variants", () => {
  const s = spec({ ...base, scenes: [
    { id: "a", type: "kineticTitle", props: { headline: "A" }, vo: [{ text: "a ".repeat(10) }] },
    { id: "b", type: "kineticTitle", props: { headline: "B" }, optional: true, vo: [{ text: "b ".repeat(10) }] },
    { id: "c", type: "ctaEndCard", props: { headline: "C", button: "Go" } },
  ], variants: [{ id: "main", aspect: "16:9" }, { id: "short", aspect: "9:16", maxDuration: 15 }, { id: "tiny", aspect: "9:16", maxDuration: 5 }] });

  it("drops optional scenes first to fit maxDuration", () => {
    const r = resolve(s, "short", words, { bpm: 96 });
    expect(r.dropped).toEqual(["b"]);
    expect(r.duration).toBeLessThanOrEqual(15);
    expect(r.aspect).toBe("9:16");
    expect([r.width, r.height]).toEqual([1080, 1920]);
  });
  it("errors clearly when it cannot fit", () => {
    expect(() => resolve(s, "tiny", words, { bpm: 96 })).toThrow(TimingError);
    expect(() => resolve(s, "tiny", words, { bpm: 96 })).toThrow(/maxDuration is 5/);
  });
});

/* ---------------- properties ---------------- */

const sceneArb = fc.record({
  def: fc.constantFrom(...SCENE_DEFS),
  vo: fc.array(fc.integer({ min: 1, max: 22 }), { maxLength: 3 }),
  tr: fc.constantFrom("cut", "crossfade", "push", "iris", "flash"),
  trDur: fc.option(fc.double({ min: 0, max: 3, noNaN: true }), { nil: undefined }),
  optional: fc.boolean(),
  bind: fc.boolean(),
});
const specArb = fc.record({
  scenes: fc.array(sceneArb, { minLength: 1, maxLength: 7 }),
  bpm: fc.integer({ min: 60, max: 150 }),
  snap: fc.constantFrom("bar", "beat", "none"),
  max: fc.option(fc.integer({ min: 4, max: 120 }), { nil: undefined }),
}).map((x) => ({
  bpm: x.bpm,
  spec: spec({ ...base, timing: { snap: x.snap },
    variants: [{ id: "main", aspect: "16:9", ...(x.max ? { maxDuration: x.max } : {}) }],
    scenes: x.scenes.map((s, i) => ({
      id: `s${i}`, type: s.def.type, props: s.def.example, optional: s.optional,
      transitionIn: { type: s.tr, ...(s.trDur !== undefined ? { duration: s.trDur } : {}) },
      vo: s.vo.map((n, j) => ({ text: Array(n).fill("w").join(" "), ...(s.bind ? { step: j } : {}) })),
    })) }),
}));

const tryResolve = (s: Spec, bpm: number, voDur = words) => {
  try { return resolve(s, "main", voDur, { bpm }); } catch (e) { if (e instanceof TimingError) return e; throw e; }
};

describe("resolve: properties", () => {
  it("VO lines never overlap and stay inside their scene", () => {
    fc.assert(fc.property(specArb, ({ spec, bpm }) => {
      const r = tryResolve(spec, bpm);
      if (r instanceof Error) return;
      const all = r.scenes.flatMap((s) => s.vo.map((v) => ({ ...v, s })));
      all.sort((a, b) => a.t - b.t);
      for (let i = 1; i < all.length; i++) expect(all[i].t).toBeGreaterThanOrEqual(all[i - 1].t + all[i - 1].dur - 1e-6);
      for (const v of all) { expect(v.t).toBeGreaterThanOrEqual(v.s.start - 1e-6); expect(v.t + v.dur).toBeLessThanOrEqual(v.s.end + 1e-6); }
    }), { numRuns: 300 });
  });

  it("scene ends land on the grid when snapping", () => {
    fc.assert(fc.property(specArb, ({ spec, bpm }) => {
      const r = tryResolve(spec, bpm);
      if (r instanceof Error || spec.timing.snap === "none") return;
      const unit = (60 / bpm) * (spec.timing.snap === "bar" ? 4 : 1);
      for (const s of r.scenes) expect(Math.abs(s.end / unit - Math.round(s.end / unit))).toBeLessThan(1e-4);
    }), { numRuns: 300 });
  });

  it("transitions stay inside both neighbours and within 40% of the shorter one", () => {
    fc.assert(fc.property(specArb, ({ spec, bpm }) => {
      const r = tryResolve(spec, bpm);
      if (r instanceof Error) return;
      for (let i = 1; i < r.scenes.length; i++) {
        const a = r.scenes[i - 1], b = r.scenes[i], t = b.transitionIn!;
        expect(t.start).toBeGreaterThanOrEqual(a.start - 1e-6);
        expect(t.end).toBeLessThanOrEqual(b.end + 1e-6);
        expect(t.end - t.start).toBeLessThanOrEqual(0.4 * Math.min(a.end - a.start, b.end - b.start) + 1e-6);
        expect((t.start + t.end) / 2).toBeCloseTo(b.start, 6);
      }
    }), { numRuns: 300 });
  });

  it("total duration grows monotonically with VO length", () => {
    fc.assert(fc.property(specArb, fc.double({ min: 1, max: 3, noNaN: true }), ({ spec, bpm }, k) => {
      const nomax: Spec = { ...spec, variants: [{ ...spec.variants[0], maxDuration: undefined }] };
      const a = tryResolve(nomax, bpm), b = tryResolve(nomax, bpm, (s, l) => words(s, l) * k);
      if (a instanceof Error || b instanceof Error) throw new Error("unexpected");
      expect(b.duration).toBeGreaterThanOrEqual(a.duration - 1e-6);
    }), { numRuns: 300 });
  });

  it("maxDuration is respected or the resolver errors", () => {
    fc.assert(fc.property(specArb, ({ spec, bpm }) => {
      const r = tryResolve(spec, bpm);
      const max = spec.variants[0].maxDuration;
      if (r instanceof Error) { expect(max).toBeDefined(); return; }
      if (max !== undefined) expect(r.duration).toBeLessThanOrEqual(max + 1e-6);
    }), { numRuns: 300 });
  });
});
