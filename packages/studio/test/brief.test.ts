import { describe, expect, it } from "vitest";
import { maxCharsIssues, validateSpec } from "@vs/spec";
import { briefToSpec, type Brief } from "../src/brief.ts";

const base: Brief = {
  goal: "launch", product: "Acme Payroll", message: "Payroll done in minutes, not days",
  problem: "Payroll day eats your whole week", audience: "HR managers",
  points: [
    { title: "Automatic tax tables", detail: "Rates update themselves every year." },
    { title: "One-click approvals", detail: "Managers approve from their phone." },
    { title: "Payslips sent instantly" }, { title: "Secure by default", detail: "SSO and a full audit trail." },
  ],
  stat: { value: 82, suffix: "%", label: "less time per pay run" }, cta: "Book a demo", url: "acme.com",
};
const long = "An extremely long piece of text that keeps going well past any sensible headline limit just to stress the fitter";

describe("briefToSpec", () => {
  for (const goal of ["launch", "promo", "announcement", "explainer", "social"] as const)
    for (const length of [15, 30, 45, 60] as const)
      for (const formats of [["16:9"], ["9:16", "1:1"]] as const)
        it(`${goal} · ${length}s · ${formats.join("+")}`, () => {
          const spec = briefToSpec({ ...base, goal, length, formats: [...formats] }, "luraplus");
          const r = validateSpec(spec);
          expect(r.issues).toEqual([]);
          if (!r.ok) return;
          for (const s of r.spec.scenes) expect(maxCharsIssues(s.type, s.props)).toEqual([]);
          expect(r.spec.scenes.at(-1)!.type).toBe("ctaEndCard");
          expect(r.spec.variants.map((v) => v.aspect)).toEqual([...formats]);
        });

  it("survives over-long inputs and minimal briefs", () => {
    for (const b of [
      { ...base, message: long, problem: long, points: base.points.map((p) => ({ title: long, detail: long + long })), cta: long, url: long },
      { goal: "promo" as const, product: "X", message: "Hi", points: [], cta: "Go" },
    ]) {
      const r = validateSpec(briefToSpec(b, "luraplus"));
      expect(r.issues).toEqual([]);
      if (r.ok) for (const s of r.spec.scenes) expect(maxCharsIssues(s.type, s.props)).toEqual([]);
    }
  });

  it("uses screenshots for the product scene and the explainer flow", () => {
    const s1: any = briefToSpec({ ...base, screenshots: ["assets/a.png"] }, "luraplus");
    expect(s1.scenes.find((s: any) => s.id === "spotlight").props.visual).toMatchObject({ kind: "image", asset: "assets/a.png" });
    const s2: any = briefToSpec({ ...base, goal: "explainer", screenshots: ["assets/a.png", "assets/b.png"] }, "luraplus");
    expect(s2.scenes.find((s: any) => s.id === "steps").type).toBe("screenFlow");
  });

  it("puts accent on the payoff and picks icons by meaning", () => {
    const s: any = briefToSpec(base, "luraplus");
    expect(s.scenes[0].props.headline).toMatch(/\*.+\*$/);
    const icons = s.scenes.find((x: any) => x.id === "benefits").props.items.map((i: any) => i.icon);
    expect(icons).toContain("shield");
  });

  it("rejects briefs without the essentials", () => {
    expect(() => briefToSpec({ ...base, product: "" }, "luraplus")).toThrow(/product/);
    expect(() => briefToSpec({ ...base, cta: "" }, "luraplus")).toThrow(/call to action/);
  });
});

describe("ideaTitle", async () => {
  const { ideaTitle } = await import("../src/idea.ts");
  it("finds a title in a pasted markdown script", () => {
    expect(ideaTitle("**Style:** Fast-paced, visual  \n**Title card:** *What If the World’s Population Suddenly Doubled?*\n\n***\n\n### Scene 1 — Hook"))
      .toBe("What If the World’s Population Suddenly Doubled?");
    expect(ideaTitle("## Launch week\nWe are shipping dark mode.")).toBe("Launch week");
    expect(ideaTitle("**Style:** calm\nBrewly is a coffee subscription for offices. Fresh beans weekly.")).toBe("Brewly is a coffee subscription for offices.");
    expect(ideaTitle("A".repeat(80) + " tail").length).toBeLessThanOrEqual(61);
  });
});
