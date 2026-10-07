import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SCENE_DEFS, SPEC_VERSION, effectiveScenes, jsonSchema, maxCharsIssues, migrate, validateSpec } from "../src/index.ts";

const minimal = (scenes: unknown[]) => ({ version: 1, title: "t", brand: "luraplus", scenes });

describe("scene catalog", () => {
  for (const d of SCENE_DEFS) {
    it(`${d.type}: example and stress fixture parse, timing is positive`, () => {
      const ex = d.schema.parse(d.example);
      const st = d.schema.parse(d.stress);
      expect(d.timing(ex as never).min).toBeGreaterThan(0);
      expect(d.timing(st as never).min).toBeGreaterThan(0);
    });
    it(`${d.type}: stress fixture validates and stays within maxChars`, () => {
      const r = validateSpec(minimal([{ id: "a", type: d.type, props: d.stress }]));
      expect(r.issues).toEqual([]);
      expect(maxCharsIssues(d.type, d.schema.parse(d.stress))).toEqual([]);
    });
  }
});

describe("spec", () => {
  it("applies defaults", () => {
    const r = validateSpec(minimal([{ id: "a", type: "kineticTitle", props: { headline: "Hi" } }]));
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.spec.fps).toBe(60);
    expect(r.spec.variants[0]).toMatchObject({ id: "main", aspect: "16:9" });
    expect(r.spec.scenes[0].props).toMatchObject({ style: "rise", align: "center" });
  });

  it("rejects unknown scene types and over-long text with a path", () => {
    const r = validateSpec(minimal([{ id: "a", type: "nope", props: {} }, { id: "b", type: "kineticTitle", props: { headline: "x".repeat(71) } }]));
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.path).join(" ")).toMatch(/scenes\.0/);
  });

  it("semantic checks: duplicate ids, unknown variant scenes, bad overrides", () => {
    const r = validateSpec({ ...minimal([
      { id: "a", type: "kineticTitle", props: { headline: "Hi" } },
      { id: "a", type: "kineticTitle", props: { headline: "Hi" } }]),
      variants: [{ id: "s", aspect: "9:16", scenes: ["zz"], overrides: { a: { props: { style: "wobble" } } } }] });
    expect(r.ok).toBe(false);
    const msgs = r.issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/duplicate scene id/);
    expect(msgs).toMatch(/unknown scene "zz"/);
    expect(msgs).toMatch(/style/);
  });

  it("maxChars is a lint check (UI enforces it), reported with a path", () => {
    expect(maxCharsIssues("featureGrid", { items: [{ icon: "check", title: "x".repeat(30) }, { icon: "check", title: "ok" }] }))
      .toEqual([{ path: "items.0.title", length: 30, maxChars: 28 }]);
    expect(maxCharsIssues("kineticTitle", { headline: "*" + "y".repeat(70) + "*" })).toEqual([]); // accent markers don't count
  });

  it("effectiveScenes applies variant + aspect overrides and fills VO ids", () => {
    const r = validateSpec({ ...minimal([
      { id: "a", type: "kineticTitle", props: { headline: "Hi" }, vo: [{ text: "one" }, { text: "two" }],
        aspectOverrides: { "9:16": { props: { align: "left" } } } },
      { id: "b", type: "ctaEndCard", props: { headline: "Go", button: "Demo" } }]),
      variants: [{ id: "main", aspect: "16:9" }, { id: "social", aspect: "9:16", scenes: ["b", "a"], overrides: { a: { vo: [{ text: "short" }] } } }] });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const main = effectiveScenes(r.spec, "main");
    expect(main[0].vo.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(main[0].transitionIn.type).toBe("cut");
    expect(main[1].transitionIn.type).toBe("iris"); // module default
    const social = effectiveScenes(r.spec, "social");
    expect(social.map((s) => s.id)).toEqual(["b", "a"]);
    expect(social[1].props.align).toBe("left");
    expect(social[1].vo).toEqual([{ id: "v1", text: "short" }]);
  });
});

describe("migrations", () => {
  it("v0 → v1 round-trips into a valid spec", () => {
    const v0 = { title: "Old", brand: "luraplus", music: "calm-explainer",
      scenes: [{ id: "a", type: "kineticTitle", props: { headline: "Hi" }, vo: ["Hello there."] }] };
    const m = migrate(v0);
    expect(m.version).toBe(SPEC_VERSION);
    const r = validateSpec(m);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.spec.music).toEqual({ mode: "preset", preset: "calm-explainer" });
    expect(r.spec.scenes[0].vo[0]).toEqual({ id: "v1", text: "Hello there." });
    expect(migrate(m)).toEqual(m); // idempotent at the current version
  });
  it("refuses specs from the future", () => {
    expect(() => migrate({ version: SPEC_VERSION + 1 })).toThrow(/newer/);
  });
});

describe("JSON Schema", () => {
  it("matches docs/schema.json (run `pnpm --filter @vs/spec schema` after schema changes)", () => {
    const file = path.resolve(__dirname, "../../../docs/schema.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(jsonSchema())));
  });
  it("carries UI metadata", () => {
    const s = JSON.stringify(jsonSchema());
    expect(s).toContain('"maxChars":70');
    expect(s).toContain('"ui":"richText"');
  });
});

import { listAssets, mapAssets } from "../src/index.ts";
describe("assets", () => {
  it("finds asset fields through unions, arrays and optionals", () => {
    const sf = SCENE_DEFS.find((d) => d.type === "screenFlow")!;
    expect(listAssets("screenFlow", sf.schema.parse(sf.example)).map((a) => a.path)).toEqual(["steps.0.screen", "steps.1.screen", "steps.2.screen"]);
    const fs = { headline: "x", visual: { kind: "image", asset: "a.png", frame: "browser" }, layout: "auto" };
    expect(mapAssets("featureSpotlight", fs, (r) => `/assets/${r}`)).toMatchObject({ visual: { asset: "/assets/a.png" } });
    expect(listAssets("featureSpotlight", { ...fs, visual: { kind: "panel", title: "t", rows: [] } })).toEqual([]);
    expect(listAssets("logoReveal", {})).toEqual([]);
  });
});
