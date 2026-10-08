/*
 * video-studio MCP server (stdio). Lets Claude (Claude Code, Claude Desktop) make videos from an idea:
 * create a project, write the storyboard, look at contact sheets, fix layout, render, report files.
 * Projects live in the same place as the web studio (studio-data/), so both see the same work.
 * stdout is the MCP channel: never console.log here.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SCENE_DEFS, catalog as sceneCatalog } from "@vs/spec";
import {
  VOICES, applyTheme, brandView, catalog, contactSheets, createVideoProject, fontLibrary, getJob, getProject, getTheme, listOutputs, listPresets, listProjects,
  listTemplates, listThemes, preview, publicJob, saveAsset, saveBrandFile, saveProjectBrand, saveSpec, startRender, initStudio,
} from "@vs/studio";

initStudio();

const log = (m: string) => process.stderr.write(`[video-studio] ${m}\n`);
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `${(e as Error).message}${(e as any).issues ? "\n" + JSON.stringify((e as any).issues, null, 1) : ""}` }] });
const wrap = <A,>(fn: (a: A) => Promise<any> | any) => async (a: A) => { try { return await fn(a); } catch (e) { log(String((e as Error).stack)); return fail(e); } };
const STUDIO = `http://127.0.0.1:${process.env.PORT ?? 5190}`;

/** Downscale an image to ≤ maxW px wide JPEG for returning to the model. */
function imageContent(file: string, maxW = 1568) {
  const tmp = path.join(os.tmpdir(), `vs-mcp-${process.pid}-${Date.now()}.jpg`);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `scale='min(${maxW},iw)':-2`, "-q:v", "4", tmp]);
  const data = fs.readFileSync(r.status === 0 ? tmp : file);
  if (r.status === 0) fs.rmSync(tmp);
  return { type: "image" as const, data: data.toString("base64"), mimeType: "image/jpeg" };
}

const server = new McpServer({ name: "video-studio", version: "0.1.0" }, {
  instructions: `Make motion-graphics videos (promos, feature launches, explainers, social cutdowns) from an idea.
Workflow: list_templates (templates + brand themes) → create_project (idea, theme or brand colours, formats, voice) → set_logo if the user
has a logo → get_spec → write the storyboard with update_spec (use list_scenes / get_scene_schema for props) → check_timing →
render_stills and LOOK at the contact sheets; fix overflow, empty space, ordering → render_video → render_status until done.
Every project has its own brand (get_brand / set_brand); there is no shared brand library.
Scenes never take durations: they last as long as their voice-over. Use *asterisks* for accent words in headlines.
The user can also open the project in the web studio at ${STUDIO} (run \`pnpm studio\` in the repo).`,
});

const themeSummary = () => listThemes().map((t) => ({ id: t.id, name: t.name, description: t.description, category: t.category, colors: t.base, fonts: t.fontFamilies, music: t.music }));
server.registerTool("list_templates", {
  title: "List templates, themes, voices",
  description: "Templates to start a video from (optional: you can also write the storyboard from scratch), brand themes (looks for projects without their own branding), fonts, music presets and voices.",
  inputSchema: {},
}, wrap(() => text({ templates: listTemplates().map(({ variants: _v, thumbnail: _t, ...t }) => t), themes: themeSummary(),
  fonts: fontLibrary().map((f) => ({ id: f.id, family: f.family, style: f.style, roles: f.roles })), musicPresets: listPresets(), voices: VOICES })));

server.registerTool("list_themes", {
  title: "List brand themes",
  description: "Ready-made looks (colours, fonts, music, voice) for projects without their own brand.",
  inputSchema: {},
}, wrap(() => text(themeSummary())));

server.registerTool("list_scenes", {
  title: "List scene types",
  description: "The scene catalog: type, what it's for, and an example of its props. Use get_scene_schema for the full field list of one type.",
  inputSchema: {},
}, wrap(() => text(SCENE_DEFS.map((d) => ({ type: d.type, label: d.meta.label, category: d.meta.category, use: d.meta.description,
  defaultMusicCue: d.meta.defaultMusicCue, defaultTransition: d.meta.defaultTransition, example: d.example })))));

server.registerTool("get_scene_schema", {
  title: "Scene props schema",
  description: "JSON Schema for one scene type's props (fields, maxChars limits, enums).",
  inputSchema: { type: z.string().describe("scene type, e.g. featureSpotlight") },
}, wrap(({ type }: { type: string }) => {
  const s = catalog().scenes.find((x) => x.type === type);
  if (!s) throw new Error(`unknown scene type "${type}". Known: ${Object.keys(sceneCatalog).join(", ")}`);
  return text(s.schema);
}));

server.registerTool("list_projects", {
  title: "List video projects",
  description: "Existing video projects (shared with the web studio).",
  inputSchema: {},
}, wrap(() => text(listProjects().map(({ thumbnail: _t, ...p }) => ({ ...p, updated: new Date(p.updated).toISOString(), studioUrl: `${STUDIO}/#/p/${p.id}` })))));

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
server.registerTool("create_project", {
  title: "Create a video project",
  description: `Create a project with its own brand and a complete first-draft storyboard: from a template, or written from the idea. Then rewrite the
spec with update_spec. Brand: pass theme (see list_themes) or your own colors (+ optional fonts); brandName is the product/company name.`,
  inputSchema: {
    title: z.string().optional().describe("video name"),
    idea: z.string().optional().describe("what the video is about (free text); required without a template"),
    template: z.string().optional().describe("template id, optional"),
    brandName: z.string().optional(), website: z.string().optional(),
    theme: z.string().optional().describe("theme id; default classic"),
    colors: z.object({ primary: Hex, accent: Hex, dark: Hex, light: Hex, ink: Hex }).optional().describe("own brand colours instead of a theme"),
    fonts: z.object({ display: z.string(), body: z.string(), mono: z.string() }).partial().optional().describe("font library ids (list_templates → fonts)"),
    formats: z.array(z.enum(["16:9", "9:16", "1:1", "4:5"])).optional(),
    voice: z.string().optional(), music: z.string().optional().describe("music preset or none"), length: z.number().optional().describe("target seconds"),
  },
}, wrap((a: any) => {
  const brand = a.colors ? { custom: { name: a.brandName || a.title || "Brand", base: a.colors,
    fonts: Object.fromEntries(Object.entries(a.fonts ?? {}).map(([r, id]) => [r, { library: id }])) } } : a.theme ? { theme: getTheme(a.theme).id, name: a.brandName } : a.brandName ? { theme: "classic", name: a.brandName } : undefined;
  const { id } = createVideoProject({ title: a.title, idea: a.idea, template: a.template, brand, name: a.brandName, url: a.website, formats: a.formats, voice: a.voice, music: a.music, length: a.length });
  return text({ project: id, studioUrl: `${STUDIO}/#/p/${id}`, spec: getProject(id).spec });
}));

server.registerTool("get_brand", {
  title: "Get the project's brand",
  description: "The project's own brand: name, colours, fonts, logo, voice, music, website.",
  inputSchema: { project: z.string() },
}, wrap(({ project }: { project: string }) => { const { urls: _u, ...b } = brandView(project); return text(b); }));

server.registerTool("set_brand", {
  title: "Change the project's brand",
  description: "Switch to a theme, or set the brand name, colours, fonts, website, music or voice. Only the fields you pass change.",
  inputSchema: { project: z.string(), theme: z.string().optional(), name: z.string().optional(), website: z.string().optional(),
    colors: z.object({ primary: Hex, accent: Hex, dark: Hex, light: Hex, ink: Hex }).partial().optional(),
    fonts: z.object({ display: z.string(), body: z.string(), mono: z.string() }).partial().optional(),
    music: z.string().optional(), voice: z.string().optional() },
}, wrap((a: any) => {
  if (a.theme) applyTheme(a.project, a.theme);
  const cur = brandView(a.project);
  const touched = a.name || a.website !== undefined || a.colors || a.fonts || a.music || a.voice;
  if (touched) saveProjectBrand(a.project, { name: a.name ?? cur.name, base: { ...cur.base, ...(a.colors ?? {}) }, ctaUrl: a.website,
    fonts: a.fonts ? Object.fromEntries(Object.entries(a.fonts).map(([r, id]) => [r, { library: id }])) : undefined,
    music: a.music, voice: a.voice ? { voice: a.voice, speed: cur.voice?.speed ?? 0.94 } : undefined });
  const { urls: _u, ...b } = brandView(a.project);
  return text({ ok: true, brand: b });
}));

server.registerTool("set_logo", {
  title: "Set the project's logo",
  description: "Use a local logo file (png, svg, webp, jpg; transparent background works best) for the project's brand. which: both (default), dark (for dark backgrounds) or light.",
  inputSchema: { project: z.string(), file: z.string().describe("absolute path"), which: z.enum(["both", "dark", "light"]).optional() },
}, wrap(({ project, file, which }: { project: string; file: string; which?: string }) => {
  const kind = which === "dark" ? "logoOnDark" : which === "light" ? "logoOnLight" : "logo";
  saveBrandFile(project, kind, path.basename(file), fs.readFileSync(file));
  return text({ ok: true });
}));

server.registerTool("get_spec", {
  title: "Get storyboard spec",
  description: "The project's storyboard spec (JSON) and its uploaded assets.",
  inputSchema: { project: z.string() },
}, wrap(({ project }: { project: string }) => { const p = getProject(project); return text({ spec: p.spec, assets: p.assets }); }));

server.registerTool("update_spec", {
  title: "Save storyboard spec",
  description: "Replace the project's storyboard spec. It is validated; on errors nothing is saved and the issues (with JSON paths) are returned. Every save keeps a revision.",
  inputSchema: { project: z.string(), spec: z.record(z.string(), z.unknown()).describe("the whole spec object") },
}, wrap(({ project, spec }: { project: string; spec: Record<string, unknown> }) => {
  const r = saveSpec(project, spec);
  return r.ok ? text({ ok: true, revision: r.revision, next: "check_timing, then render_stills" }) : { isError: true, ...text({ ok: false, issues: r.issues }) };
}));

server.registerTool("add_asset", {
  title: "Add an image to a project",
  description: "Copy a local image (png/jpg/webp, e.g. a product screenshot the user provided) into the project. Returns the path to use in scene props (e.g. assets/screen.png).",
  inputSchema: { project: z.string(), file: z.string().describe("absolute path to the image") },
}, wrap(({ project, file }: { project: string; file: string }) => text({ path: saveAsset(project, path.basename(file), fs.readFileSync(file)) })));

server.registerTool("check_timing", {
  title: "Resolve timing and lint",
  description: "Synthesizes the voice-over (cached), resolves scene timing for a format, and runs layout lint (overflow, safe area, length limits). Fix every lint issue before rendering.",
  inputSchema: { project: z.string(), variant: z.string().optional().describe("format id, default the first") },
}, wrap(async ({ project, variant }: { project: string; variant?: string }) => {
  const r = await preview(project, variant);
  return text({ variant: r.variant, formats: r.variants, duration: +r.duration.toFixed(2),
    scenes: r.scenes.map((s) => ({ id: s.id, start: +s.start.toFixed(2), end: +s.end.toFixed(2), voiceOver: s.vo.map((v) => `${v.id}@${v.t.toFixed(2)}+${v.dur.toFixed(2)}s`) })),
    lint: r.lint, warnings: r.warnings, dropped: r.dropped });
}));

server.registerTool("render_stills", {
  title: "Contact sheet",
  description: "Render stills at each scene's key moments and return the contact sheet image(s) so you can check the layout visually. Look for wrapped headlines, empty space, overlaps, text near edges.",
  inputSchema: { project: z.string(), variant: z.string().optional() },
}, wrap(async ({ project, variant }: { project: string; variant?: string }) => {
  const r = await contactSheets(project, variant);
  const content: any[] = [];
  for (const v of r) {
    content.push({ type: "text", text: `Format "${v.variant}": ${v.files.length} stills, lint: ${v.lint.length ? JSON.stringify(v.lint) : "clean"}` });
    if (v.sheet) content.push(imageContent(v.sheet));
  }
  return { content };
}));

server.registerTool("render_video", {
  title: "Render the video",
  description: "Start rendering (voice-over, music, sound design, picture). Runs in the background; poll render_status. quality: draft (fast preview) | standard (final) | cinema (60 fps). deliverables: all (master, web, social, landing, captions, thumbnails) or none.",
  inputSchema: { project: z.string(), variants: z.array(z.string()).optional(), quality: z.enum(["draft", "standard", "cinema"]).optional(),
    deliverables: z.enum(["all", "none"]).optional() },
}, wrap(({ project, variants, quality, deliverables }: { project: string; variants?: string[]; quality?: "draft" | "standard" | "cinema"; deliverables?: "all" | "none" }) => {
  const j = startRender(project, { variants, quality, deliverables: deliverables === "none" ? "none" : ["all"] });
  return text({ job: j.id, status: j.status, next: "call render_status every ~30 s until done" });
}));

server.registerTool("render_status", {
  title: "Render progress",
  description: "Progress of a render job; when done, the output files (absolute paths).",
  inputSchema: { job: z.string() },
}, wrap(({ job }: { job: string }) => {
  const j = getJob(job);
  if (!j) throw new Error(`no render job "${job}" (jobs live as long as this server process)`);
  const pj = publicJob(j);
  const dir = getProject(j.project).dir;
  return text({ status: pj.status, progress: `${Math.round(pj.progress * 100)}%`, message: pj.message, error: pj.error,
    outputs: pj.outputs.map((o) => ({ variant: o.variant, files: o.files.map((f) => path.join(dir, f)) })),
    studioUrl: `${STUDIO}/#/p/${j.project}` });
}));

server.registerTool("list_outputs", {
  title: "Rendered files",
  description: "Files already rendered for a project, by format.",
  inputSchema: { project: z.string() },
}, wrap(({ project }: { project: string }) => {
  const dir = getProject(project).dir;
  return text(listOutputs(project).map((o) => ({ variant: o.variant, files: o.files.map((f) => ({ file: path.join(dir, f.path), MB: +(f.bytes / 1e6).toFixed(1) })) })));
}));

await server.connect(new StdioServerTransport());
log("ready");
