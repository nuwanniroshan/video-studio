import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { BrandKit, SCENE_DEFS, jsonSchema, migrate, validateSpec } from "@vs/spec";
import {
  QUALITY, REPO, SpecError, analyze, contactSheet, deliverables, env, prepare, render, serveProject, slug, stills, voFor, vsaudio,
  type DeliverableSet, type Quality,
} from "@vs/render";
import { effectiveScenes } from "@vs/spec";
import { dev } from "./dev.ts";

const program = new Command().name("vs").description("video-studio: storyboard spec in, finished video out").version("0.1.0");
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const nums = (s: string) => list(s).map(Number);
const say = (m: string) => process.stderr.write(m + "\n");

function fail(e: unknown): never {
  if (e instanceof SpecError) {
    say(`✗ ${e.message}`);
    for (const i of e.issues) say(`  ${i.path || "(root)"}: ${i.message}`);
  } else if ((e as Error)?.name === "TimingError" || (e as Error)?.constructor?.name === "TimingError") say(`✗ ${(e as Error).message}`);
  else say(`✗ ${(e as Error).stack ?? e}`);
  process.exit(1);
}

program.command("init")
  .description("Start a project from a template")
  .argument("<dir>", "project directory to create")
  .option("-t, --template <name>", "template", "feature-launch")
  .option("-b, --brand <id>", "brand kit id", "luraplus")
  .action((dir: string, o: { template: string; brand: string }) => {
    const src = path.join(REPO, "templates", o.template);
    if (!fs.existsSync(src)) fail(new Error(`unknown template "${o.template}" (have: ${fs.readdirSync(path.join(REPO, "templates")).join(", ")})`));
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) fail(new Error(`${dir} is not empty`));
    fs.cpSync(src, dir, { recursive: true });
    const sp = path.join(dir, "spec.json");
    const spec = JSON.parse(fs.readFileSync(sp, "utf8"));
    spec.brand = o.brand;
    spec.$schema = path.relative(path.resolve(dir), path.join(REPO, "docs/schema.json"));
    fs.writeFileSync(sp, JSON.stringify(spec, null, 2) + "\n");
    say(`✓ created ${sp}\n  next: vs validate ${sp} && vs stills ${sp}`);
  });

program.command("validate")
  .description("Validate a spec (schema + semantic checks). --resolve also runs TTS and the timing resolver.")
  .argument("<spec>")
  .option("--resolve", "synthesize VO and resolve every variant")
  .option("--json", "machine-readable output")
  .action(async (sp: string, o: { resolve?: boolean; json?: boolean }) => {
    const r = validateSpec(migrate(JSON.parse(fs.readFileSync(sp, "utf8"))));
    if (!r.ok) {
      if (o.json) console.log(JSON.stringify({ ok: false, issues: r.issues }, null, 1));
      else { say(`✗ ${sp}: ${r.issues.length} issue(s)`); r.issues.forEach((i) => say(`  ${i.path}: ${i.message}`)); }
      process.exit(1);
    }
    if (!o.resolve) { o.json ? console.log(JSON.stringify({ ok: true })) : say(`✓ ${sp} is valid`); return; }
    try {
      const p = await prepare(sp);
      const out = p.variants.map((v) => ({ variant: v.id, aspect: v.resolved.aspect, duration: v.resolved.duration, dropped: v.resolved.dropped, warnings: v.resolved.warnings,
        scenes: v.resolved.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, vo: s.vo.map((x) => [x.id, +x.t.toFixed(2), +x.dur.toFixed(2)]) })) }));
      if (o.json) console.log(JSON.stringify({ ok: true, variants: out }, null, 1));
      else for (const v of out) {
        say(`✓ ${v.variant} (${v.aspect}): ${v.duration.toFixed(2)} s${v.dropped.length ? `, dropped ${v.dropped.join(", ")}` : ""}`);
        for (const s of v.scenes) say(`    ${s.id.padEnd(14)} ${s.start.toFixed(2).padStart(6)} → ${s.end.toFixed(2).padStart(6)}  ${s.vo.map((x) => `${x[0]}@${x[1]}+${x[2]}`).join(" ")}`);
        v.warnings.forEach((w) => say(`  ! ${w}`));
      }
    } catch (e) { fail(e); }
  });

program.command("lint")
  .description("Layout lint every variant (headless): overflow, safe area, maxChars, missing assets, render-cost warnings")
  .argument("<spec>")
  .option("-v, --variant <ids>", "comma-separated variants")
  .option("--json")
  .action(async (sp: string, o: { variant?: string; json?: boolean }) => {
    try {
      const p = await prepare(sp, o.variant ? list(o.variant) : undefined);
      const srv = await serveProject(p.project);
      const res: Record<string, unknown> = {};
      let n = 0;
      for (const v of p.variants) { const a = await analyze(srv, v.doc); res[v.id] = a.lint; n += a.lint.length; if (!o.json) { say(`${a.lint.length ? "!" : "✓"} ${v.id}: ${a.lint.length} issue(s)`); a.lint.forEach((l) => say(`  ${l.level} [${l.scene}] ${l.code}: ${l.message}`)); } }
      await srv.close();
      if (o.json) console.log(JSON.stringify(res, null, 1));
      process.exit(n ? 2 : 0);
    } catch (e) { fail(e); }
  });

program.command("stills")
  .description("Render stills at times (or at scene cues) and a contact sheet, for visual QA")
  .argument("<spec>")
  .option("--at <times>", "comma-separated seconds")
  .option("--every <sec>", "one still every N seconds")
  .option("-v, --variant <id>", "variant (default: all)")
  .option("-o, --out <dir>", "output directory (default: <spec dir>/out/stills)")
  .action(async (sp: string, o: { at?: string; every?: string; variant?: string; out?: string }) => {
    try {
      const out = o.out ?? path.join(path.dirname(path.resolve(sp)), "out", "stills");
      const r = await stills({ specPath: sp, variant: o.variant, times: o.at ? nums(o.at) : undefined, every: o.every ? +o.every : undefined, outDir: out });
      for (const v of r) {
        say(`✓ ${v.variant}: ${v.files.length} stills${v.sheet ? `, sheet ${v.sheet}` : ""}`);
        v.lint.forEach((l) => say(`  lint ${l.level} [${l.scene}] ${l.code}: ${l.message}`));
      }
    } catch (e) { fail(e); }
  });

program.command("render")
  .description("Render variants to video (segment cache; only changed segments re-render)")
  .argument("<spec>")
  .option("-v, --variant <ids>", "comma-separated variants (default: all)")
  .option("-q, --quality <tier>", `quality: ${Object.keys(QUALITY).join(" | ")}`)
  .option("-w, --workers <n>", "parallel Chromium workers")
  .option("-o, --out <dir>", "output directory (default: <spec dir>/out)")
  .option("-d, --deliverables <sets>", "none | all | master,web,hero,landing,captions,stills,stems", "captions")
  .option("--json", "print a JSON summary on stdout")
  .action(async (sp: string, o: { variant?: string; quality?: Quality; workers?: string; out?: string; deliverables: string; json?: boolean }) => {
    try {
      let last = 0;
      const { results, prepared } = await render({
        specPath: sp, variants: o.variant ? list(o.variant) : undefined, quality: o.quality, workers: o.workers ? +o.workers : undefined, outDir: o.out,
        log: say,
        onProgress: (p) => { const now = Date.now(); if (now - last > 2000 || p.done === p.total) { last = now; say(`  ${p.variant}: ${p.done}/${p.total} frames`); } },
      });
      const sets = list(o.deliverables) as DeliverableSet[];
      if (!sets.includes("none" as DeliverableSet)) {
        for (const r of results) {
          const v = prepared.variants.find((x) => x.id === r.variant)!;
          const base = `${slug(prepared.project.spec.title)}_${r.variant}`;
          const t = Date.now();
          const files = await deliverables({ video: path.join(path.dirname(r.file), `.${base}_video.mp4`), mix: r.mix, stems: r.stems, resolved: v.resolved,
            outDir: path.dirname(r.file), base, fps: v.doc.fps }, sets, say);
          (r as any).deliverables = { files, seconds: (Date.now() - t) / 1000 };
        }
      }
      for (const r of results) {
        const a = r.audio as Record<string, number>;
        say(`✓ ${r.variant}: ${r.file}\n    ${r.duration.toFixed(2)} s, ${r.frames} frames; segments ${r.segments.rendered} rendered / ${r.segments.hits} cached; ` +
          `${r.seconds.total.toFixed(1)} s (segments ${r.seconds.segments.toFixed(1)}, audio ${r.seconds.audio.toFixed(1)}, assemble ${r.seconds.assemble.toFixed(1)}); ` +
          `audio ${a.lufs} LUFS, TP ${a.truePeakDb} dBTP; lint ${r.lint.length}`);
      }
      if (o.json) console.log(JSON.stringify(results, null, 1));
    } catch (e) { fail(e); }
  });

program.command("scenes")
  .description("List scene types (with --json: schemas, defaults, examples)")
  .option("--json")
  .action(async (o: { json?: boolean }) => {
    const { z } = await import("zod");
    if (o.json) console.log(JSON.stringify(SCENE_DEFS.map((d) => ({ type: d.type, version: d.version, meta: d.meta, example: d.example, schema: z.toJSONSchema(d.schema, { io: "input", unrepresentable: "any" }) })), null, 1));
    else for (const d of SCENE_DEFS) say(`${d.type.padEnd(18)} ${d.meta.category.padEnd(9)} ${d.meta.description}`);
  });

program.command("schema")
  .description("Print the spec JSON Schema")
  .action(() => console.log(JSON.stringify(jsonSchema(), null, 2)));

const brand = program.command("brand").description("Brand kits");
brand.command("import")
  .argument("<dir>", "directory containing brand.json, fonts and logos")
  .action((dir: string) => {
    try {
      const kit = BrandKit.parse(JSON.parse(fs.readFileSync(path.join(dir, "brand.json"), "utf8")));
      for (const f of [kit.fonts.display.file, kit.fonts.body.file, kit.fonts.mono.file, kit.logo.onDark, kit.logo.onLight])
        if (!fs.existsSync(path.join(dir, f))) throw new Error(`brand file missing: ${f}`);
      const dst = path.join(env.brandsDir(), kit.id);
      fs.cpSync(dir, dst, { recursive: true });
      say(`✓ imported brand "${kit.id}" → ${dst}`);
    } catch (e) { fail(e); }
  });
brand.command("list").action(() => { for (const d of fs.readdirSync(env.brandsDir())) say(d); });

program.command("qa")
  .description("Whisper QA of the voice-over (brand dictionary terms are excluded from scoring)")
  .argument("<spec>")
  .option("-v, --variant <id>")
  .action(async (sp: string, o: { variant?: string }) => {
    try {
      const p = await prepare(sp, o.variant ? [o.variant] : undefined);
      const lines = new Map<string, { id: string; text: string; wav: string }>();
      for (const v of p.variants) for (const s of effectiveScenes(p.project.spec, v.id)) for (const l of s.vo)
        lines.set(l.text, { id: `${s.id}.${l.id}`, text: l.text, wav: voFor(p.vo, l.text, l.phonemes)!.wav });
      const r = await vsaudio<{ ok: boolean; lines: { id: string; heard: string; score: number; missing: string[]; ignored: string[] }[] }>("qa",
        { model: "small.en", dictionary: p.project.brand.pronunciations, lines: [...lines.values()] });
      for (const l of r.lines) say(`${l.score >= 0.8 ? "✓" : "✗"} ${l.id.padEnd(16)} ${(l.score * 100).toFixed(0).padStart(3)}%  heard: "${l.heard}"${l.missing.length ? `  missing: ${l.missing.join(", ")}` : ""}${l.ignored.length ? `  (ignored: ${l.ignored.join(", ")})` : ""}`);
      process.exit(r.ok ? 0 : 2);
    } catch (e) { fail(e); }
  });

program.command("dev")
  .description("Local preview: player with scrubber, reloads the spec on refresh")
  .argument("<spec>")
  .option("-v, --variant <id>")
  .option("-p, --port <n>", "port", "5180")
  .action((sp: string, o: { variant?: string; port: string }) => dev(sp, o.variant, +o.port).catch(fail));

program.command("sheet")
  .description("Contact sheet from a rendered video (REFERENCE §3 QA loop)")
  .argument("<video>")
  .option("--every <sec>", "seconds between frames", "2")
  .action(async (video: string, o: { every: string }) => {
    const out = video.replace(/\.mp4$/, "") + "-sheet.jpg";
    const { run } = await import("@vs/render");
    await run(["-i", video, "-vf", `fps=1/${o.every},scale=384:-1,tile=5x5:padding=4`, "-frames:v", "1", out]);
    say(`✓ ${out}`);
  });

void contactSheet;
program.parseAsync().catch(fail);
