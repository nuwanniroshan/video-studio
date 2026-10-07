import { describe, expect, it } from "vitest";
import { createTimeline, ease } from "../src/index.ts";

const el = () => document.createElement("div");

describe("engine", () => {
  it("tweens and composes transform/opacity/filter", () => {
    const tl = createTimeline();
    const a = el();
    tl.tw(a, 1, 1, { x: 0, o: 0, blur: 8 }, { x: 100, o: 1, blur: 0 }, "linear");
    tl.seek(1.5);
    expect(a.style.transform).toContain("translate(50.00px");
    expect(a.style.opacity).toBe("0.5000");
    expect(a.style.filter).toBe("blur(4.00px)");
    tl.seek(5);
    expect(a.style.filter).toBe("none");
  });

  it("pitfall 1: overlapping continue segment starts from the live value, not the previous target", () => {
    const tl = createTimeline();
    const a = el();
    tl.tw(a, 0, 2, { x: 0 }, { x: 100 }, "linear");
    tl.to(a, 1, 1, { x: 0 }, "linear"); // starts mid-way through the first
    expect(tl.valueAt(a, "x", 1)).toBeCloseTo(50, 5); // prototype jumped to 100
    expect(tl.valueAt(a, "x", 0.999)).toBeCloseTo(49.95, 1);
  });

  it("pitfall 2: initial() governs the value before the first segment", () => {
    const tl = createTimeline();
    const a = el();
    tl.hide(a).to(a, 3, 0.5, { o: 1 });
    expect(tl.valueAt(a, "o", 0)).toBe(0); // prototype resolved null → default 1 → flash
    expect(tl.valueAt(a, "o", 4)).toBe(1);
  });

  it("pitfall 3: keyed fns – latest started runs; earliest runs before any start", () => {
    const tl = createTimeline();
    const log: string[] = [];
    tl.fn(2, 1, () => log.push("A"), { key: "sheen" });
    tl.fn(5, 1, () => log.push("B"), { key: "sheen" });
    tl.seek(0); tl.seek(3); tl.seek(5.5); tl.seek(9);
    expect(log).toEqual(["A", "A", "B", "B"]);
  });

  it("pitfall 4: from() refuses props without rest defaults", () => {
    const tl = createTimeline();
    expect(() => tl.from(el(), 0, 1, { pct: 0 })).toThrow(/no rest default/);
  });

  it("scopes shift time and only evaluate while active", () => {
    const tl = createTimeline();
    const a = el();
    const sc = tl.scope(10, { id: "s1", start: 10, end: 12 });
    sc.tw(a, 0, 1, { x: 0 }, { x: 10 }, "linear");
    tl.seek(10.5);
    expect(a.style.transform).toContain("translate(5.00px");
    tl.seek(20); // inactive: untouched
    expect(a.style.transform).toContain("translate(5.00px");
    expect(tl.valueAt(a, "x", 20)).toBe(10);
  });

  it("emit records absolute marker times", () => {
    const tl = createTimeline();
    tl.scope(4, { id: "s" }).emit("whoosh", 0.5, { gain: 1 });
    expect(tl.markers()).toEqual([{ kind: "whoosh", t: 4.5, scope: "s", data: { gain: 1 } }]);
  });

  it("activity detects static intervals", () => {
    const tl = createTimeline();
    tl.tw(el(), 1, 1, { x: 0 }, { x: 1 });
    expect(tl.activity(0, 0.9)).toBe(false);
    expect(tl.activity(1.5)).toBe(true);
    expect(tl.activity(2.1, 3)).toBe(false);
  });

  it("seeded per-scope random is stable", () => {
    const a = createTimeline().scope(0, { id: "hook" }).random;
    const b = createTimeline().scope(0, { id: "hook" }).random;
    expect([a(), a()]).toEqual([b(), b()]);
  });

  it("revealWords keeps inline tags", () => {
    const tl = createTimeline();
    const h = el();
    h.innerHTML = 'Run <span class="blue">payroll</span><br/> fast';
    const ws = tl.revealWords(h, 0);
    expect(ws.map((w) => w.textContent)).toEqual(["Run", "payroll", "fast"]);
    expect(h.querySelector("span.blue .wi")).not.toBeNull();
  });

  it("seek is order-independent (determinism)", () => {
    const build = () => {
      const tl = createTimeline();
      const a = el();
      tl.from(a, 0, 1, { y: 40, o: 0, blur: 8 }).to(a, 0.6, 1, { s: 1.2 }, ease.back);
      return { tl, a };
    };
    const x = build(), y = build();
    const ts = [0.1, 0.7, 1.3, 0.4];
    const out1 = ts.map((t) => (x.tl.seek(t), x.a.style.cssText));
    const out2 = [...ts].reverse().map((t) => (y.tl.seek(t), y.a.style.cssText)).reverse();
    expect(out1).toEqual(out2);
  });
});
