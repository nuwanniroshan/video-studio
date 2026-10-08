import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { deriveColors, contrast } from "@vs/brand";
import { loadProject } from "@vs/render";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "vs-studio-test-"));
process.env.VS_STUDIO_HOME = home;
const st = await import("../src/index.ts");

describe("themes", () => {
  it("lists every theme with fonts from the library and legible derived colours", () => {
    const ts = st.listThemes();
    expect(ts.length).toBeGreaterThanOrEqual(10);
    for (const t of ts) {
      expect(Object.values(t.fontFamilies).every((f) => !f.includes("undefined"))).toBe(true);
      expect(t.fontUrls.display).toMatch(/^\/api\/fonts\/.+\.ttf$/);
      const c = deriveColors(t.base);
      expect(contrast(c.primaryText, t.base.light)).toBeGreaterThanOrEqual(3);   // accent text on light scenes
      expect(contrast(c.onPrimary, t.base.primary)).toBeGreaterThanOrEqual(2.5);  // button labels
      expect(contrast("#FFFFFF", t.base.dark)).toBeGreaterThanOrEqual(10);       // headlines on dark scenes
    }
  });
  it("rejects an unknown theme", () => expect(() => st.getTheme("nope")).toThrow(/unknown theme/));
});

describe("ideaToBrief", () => {
  it("pulls name, problem, bullet points and a stat out of free text", () => {
    const b = st.ideaToBrief({ idea: "Brewly is a coffee subscription for small offices.\nTeams waste time ordering coffee.\n- Fresh beans weekly\n- One invoice\nOffices save 30% on coffee.", length: 30 });
    expect(b.product).toBe("Brewly");
    expect(b.problem).toMatch(/waste time/);
    expect(b.points.map((p) => p.title)).toEqual(["Fresh beans weekly", "One invoice"]);
    expect(b.stat).toMatchObject({ value: 30, suffix: "%" });
    expect(b.goal).toBe("promo");
  });
  it("guesses the kind of video", () => {
    expect(st.guessGoal("How to send your first invoice in three steps")).toBe("explainer");
    expect(st.guessGoal("Launching dark mode")).toBe("launch");
    expect(st.guessGoal("We're opening in Austin")).toBe("announcement");
    expect(st.guessGoal("Anything", 15)).toBe("social");
  });
});

describe("projects own their brand", () => {
  beforeAll(() => st.initStudio());
  it("creates a project from an idea with a theme brand and a valid first draft", () => {
    const { id } = st.createVideoProject({ idea: "Brewly is a coffee subscription for small offices. Fresh beans every week, one invoice.", name: "Brewly",
      brand: { theme: "evergreen" }, formats: ["16:9", "9:16"], url: "brewly.co", voice: "bf_emma" });
    const p = st.getProject(id);
    expect(p.spec.brand).toBe(id);
    expect(p.spec.variants.map((v: any) => v.aspect)).toEqual(["16:9", "9:16"]);
    expect(p.spec.voice.voice).toBe("bf_emma");
    const b = st.brandView(id);
    expect(b.name).toBe("Brewly");
    expect(b.theme).toBe("evergreen");
    expect(b.cta.url).toBe("brewly.co");
    expect(b.wordmark).toEqual({ onDark: true, onLight: true });
    // the renderer resolves the project's own brand folder
    const proj = loadProject(path.join(p.dir, "spec.json"), { cacheDir: path.join(home, "cache") });
    expect(proj.brandDir).toBe(path.join(p.dir, "brand"));
    expect(proj.brand.fonts.display.family).toBe("DM Sans");
  });
  it("custom brand + logo upload + theme switch keeps identity", () => {
    const { id } = st.createVideoProject({ idea: "A short promo for Acme rockets that fly further.", brand: { custom: { name: "Acme", base: { primary: "#E11D48", accent: "#F59E0B", dark: "#111111", light: "#FAFAFA", ink: "#111111" }, fonts: { display: { library: "sora" } } } } });
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    let b = st.saveBrandFile(id, "logo", "acme.png", png);
    expect(b.logo).toMatchObject({ onDark: "assets/logo.png", onLight: "assets/logo.png" });
    expect(b.fonts.display.family).toBe("Sora");
    b = st.applyTheme(id, "ocean");
    expect(b.name).toBe("Acme");
    expect(b.logo.onDark).toBe("assets/logo.png");
    expect(b.colors.primary).toBe("#0EA5E9");
    b = st.removeBrandLogo(id);
    expect(b.wordmark.onDark).toBe(true);
    expect(() => st.saveBrandFile(id, "logo", "x.svg", Buffer.from("<svg onload=alert(1)>"))).toThrow(/scripts/);
  });
  it("starts from a template, swapping the sample product name for the brand name", () => {
    const { id } = st.createVideoProject({ template: "event-invite", name: "Brightly", brand: { theme: "pop", name: "Brightly" } });
    const text = JSON.stringify(st.getProject(id).spec);
    expect(text).not.toContain("Northwind");
    expect(text).toContain("Brightly");
  });
  it("needs an idea or a template", () => expect(() => st.createVideoProject({ idea: "  " })).toThrow(/describe the video/));
  it("gives projects from older versions their own copy of the shared brand", () => {
    const d = path.join(home, "projects", "legacy");
    fs.mkdirSync(d, { recursive: true });
    const tpl = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../templates/feature-launch/spec.json"), "utf8"));
    fs.writeFileSync(path.join(d, "spec.json"), JSON.stringify({ ...tpl, brand: "luraplus" }));
    st.initStudio();
    expect(st.getProject("legacy").spec.brand).toBe("legacy");
    expect(st.brandView("legacy").name).toBe("LuraPlus");
  });
});

describe("original videos", () => {
  it("guesses a fitting theme from the idea when the look is left to the agent", () => {
    expect(st.guessTheme("A promo for our barista coffee bar")).toBe("editorial");
    expect(st.guessTheme("Yoga studio opening")).toBe("care");
    expect(st.guessTheme("Payroll for small teams")).toBe("trust");
    expect(st.guessTheme("Something else entirely")).toBe("classic");
    const { id } = st.createVideoProject({ idea: "A cosy barista coffee bar on Mill Street, single-origin pour-overs.", name: "Ember", brand: { theme: "auto", name: "Ember" } });
    const kit = JSON.parse(fs.readFileSync(path.join(home, "projects", id, "brand", "brand.json"), "utf8"));
    expect(kit.theme).toBe("editorial");
    const req = JSON.parse(fs.readFileSync(path.join(home, "projects", id, "request.json"), "utf8"));
    expect(req.brand.theme).toBe("auto");
  });
});
