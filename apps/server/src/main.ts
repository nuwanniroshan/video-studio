/*
 * Local studio server (M2-minimum): JSON API + the web SPA + a same-origin proxy to the runtime
 * server (so the preview iframe and the API share an origin). Binds 127.0.0.1 only; no auth yet.
 *   pnpm studio   → http://127.0.0.1:5190
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { REPO, type Quality } from "@vs/render";
import {
  StudioError, initStudio, brandView, saveProjectBrand, saveBrandFile, removeBrandLogo, applyTheme, listThemes, testVoice, fontLibrary, fontFile, templateThumb,
  saveUpload, previewAudio, briefToSpec, ideaToBrief, type BrandFileKind, catalog, contactSheets, createVideoProject, deleteProject, getJob, getProject, listJobs, listOutputs,
  listProjects, listTemplates, preview, projectFile, projectRequest, publicJob, runtimeOrigin, saveAsset, saveSpec, startRender,
  agentStatus, startAgent, stopAgent, getAgentJob, listAgentJobs, publicAgentJob,
} from "@vs/studio";

initStudio();
const PORT = +(process.env.PORT ?? 5190);
const WEB = path.join(REPO, "apps/web/dist");
const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

app.setErrorHandler((e, _req, reply) => {
  const err = e as Error & { status?: number; issues?: unknown };
  const status = e instanceof StudioError ? e.status : (err as any).statusCode ?? 500;
  if (status >= 500) console.error(err);
  reply.status(status).send({ error: err.message, issues: (e as StudioError).issues ?? (err as any).issues });
});

type P = { Params: { id: string } };

// The agent prompt, scene catalogue and project logic live in this process: after a code update the server must
// restart, or new videos keep the old behaviour. The UI polls this and shows a banner.
const SRC = ["packages", "apps/server/src", "apps/mcp/src"].map((d) => path.join(REPO, d));
const newestSource = () => {
  let t = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "test") continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (/\.(ts|css)$/.test(e.name)) t = Math.max(t, fs.statSync(f).mtimeMs);
    }
  };
  SRC.forEach((d) => fs.existsSync(d) && walk(d));
  return t;
};
const STARTED = Date.now(), BOOT_SRC = newestSource();
let srcCheck = { at: 0, stale: false };
app.get("/api/health", async () => {
  if (Date.now() - srcCheck.at > 10_000) srcCheck = { at: Date.now(), stale: newestSource() > Math.max(BOOT_SRC, STARTED) };
  return { started: STARTED, stale: srcCheck.stale };
});
app.get("/api/catalog", async () => catalog());
app.get("/api/templates", async () => listTemplates());
app.get("/api/themes", async () => listThemes());
app.get<{ Params: { id: string } }>("/api/templates/:id/thumb.jpg", async (req, reply) => reply.type("image/jpeg").send(fs.createReadStream(templateThumb(req.params.id))));
app.get("/api/fonts", async () => fontLibrary());
app.get<{ Params: { file: string } }>("/api/fonts/:file", async (req, reply) => reply.type("font/ttf").send(fs.createReadStream(fontFile(req.params.file))));
// each project owns its brand
app.get<P>("/api/projects/:id/brand", async (req) => brandView(req.params.id));
app.put<P & { Body: any }>("/api/projects/:id/brand", async (req) => saveProjectBrand(req.params.id, req.body as never));
app.post<P & { Body: { theme: string } }>("/api/projects/:id/brand/theme", async (req) => applyTheme(req.params.id, req.body.theme));
app.delete<P>("/api/projects/:id/brand/logo", async (req) => removeBrandLogo(req.params.id));
app.post<P & { Querystring: { kind: BrandFileKind } }>("/api/projects/:id/brand/files", async (req) => {
  const f = await req.file();
  if (!f) throw new StudioError(400, "no file");
  return saveBrandFile(req.params.id, req.query.kind, f.filename, await f.toBuffer());
});
app.post<{ Body: { text: string; voice?: string; speed?: number; pronunciations?: Record<string, unknown>; project?: string } }>("/api/voice-test", async (req, reply) => {
  const r = await testVoice(req.body);
  return reply.type("audio/wav").send(fs.createReadStream(r.wav));
});
app.post("/api/uploads", async (req) => {
  const f = await req.file();
  if (!f) throw new StudioError(400, "no file");
  return { ref: saveUpload(f.filename, await f.toBuffer()) };
});
// the rule-based outline for an idea (shown while typing; no AI)
app.post("/api/idea-preview", async (req) => {
  const b = req.body as any;
  const brief = ideaToBrief({ ...b, idea: b.idea || "Your product makes work simple.", screenshots: (b.screenshots ?? []).map((_: string, i: number) => `assets/screenshot-${i + 1}.png`) });
  return { brief, spec: briefToSpec({ ...brief, product: brief.product }, "preview") };
});
// new project: own brand + first draft; with agent:true the AI agent then writes the storyboard
app.post<{ Body: any }>("/api/projects/new", async (req) => {
  const { agent, model, ...o } = (req.body ?? {}) as { agent?: boolean; model?: string; [k: string]: unknown };
  const { id } = createVideoProject(o);
  const job = agent ? startAgent(id, { mode: "create", model }) : null;
  return { id, agentJob: job?.id };
});
app.get<P>("/api/projects/:id/request", async (req) => projectRequest(req.params.id) ?? {});
// the agent
app.get("/api/agent/status", async () => agentStatus());
app.post<P & { Body: { instruction?: string; mode?: "create" | "revise"; model?: string } }>("/api/projects/:id/agent", async (req) =>
  publicAgentJob(startAgent(req.params.id, { mode: req.body?.mode ?? "revise", instruction: req.body?.instruction, model: req.body?.model })));
app.get<P>("/api/projects/:id/agent", async (req) => listAgentJobs(req.params.id));
app.post<{ Params: { job: string } }>("/api/agent/:job/stop", async (req) => stopAgent(req.params.job));
app.get<{ Params: { job: string } }>("/api/agent/:job/events", (req, reply) => {
  const job = getAgentJob(req.params.job);
  if (!job) return reply.status(404).send({ error: "no such agent run" });
  reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (j: unknown) => reply.raw.write(`data: ${JSON.stringify(j)}\n\n`);
  send(publicAgentJob(job));
  const on = (j: unknown) => send(j);
  job.events.on("update", on);
  req.raw.on("close", () => job.events.off("update", on));
});
app.post<P & { Body: { variant?: string } }>("/api/projects/:id/preview-audio", async (req) => {
  const r = await previewAudio(req.params.id, req.body?.variant);
  return { url: `/files/${req.params.id}/${r.path}?v=${Date.now()}`, lufs: r.lufs };
});
app.get("/api/projects", async () => listProjects());
app.get<P>("/api/projects/:id", async (req) => { const p = getProject(req.params.id); return { id: p.id, spec: p.spec, assets: p.assets }; });
app.delete<P>("/api/projects/:id", async (req) => { deleteProject(req.params.id); return { ok: true }; });
app.put<P>("/api/projects/:id/spec", async (req, reply) => {
  const r = saveSpec(req.params.id, req.body);
  if (!r.ok) reply.status(422);
  return r;
});
app.post<P>("/api/projects/:id/assets", async (req) => {
  const f = await req.file();
  if (!f) throw new StudioError(400, "no file");
  return { path: saveAsset(req.params.id, f.filename, await f.toBuffer()) };
});
app.post<P & { Body: { variant?: string } }>("/api/projects/:id/preview", async (req) => preview(req.params.id, req.body?.variant));
app.post<P & { Body: { variant?: string } }>("/api/projects/:id/stills", async (req) => {
  const r = await contactSheets(req.params.id, req.body?.variant);
  return r.map((v) => ({ variant: v.variant, sheet: v.sheet && `/files/${req.params.id}/${path.relative(getProject(req.params.id).dir, v.sheet)}`, lint: v.lint }));
});
app.get<P>("/api/projects/:id/outputs", async (req) => listOutputs(req.params.id));
app.post<P & { Body: { variants?: string[]; quality?: Quality; deliverables?: "none" | "all" } }>("/api/projects/:id/renders", async (req) => {
  const b = req.body ?? {};
  return publicJob(startRender(req.params.id, { variants: b.variants, quality: b.quality, deliverables: b.deliverables === "none" ? "none" : ["all"] }));
});
app.get<P>("/api/projects/:id/renders", async (req) => listJobs(req.params.id).map(publicJob));
app.get<{ Params: { job: string } }>("/api/renders/:job/events", (req, reply) => {
  const job = getJob(req.params.job);
  if (!job) return reply.status(404).send({ error: "no such render" });
  reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (j: unknown) => reply.raw.write(`data: ${JSON.stringify(j)}\n\n`);
  send(publicJob(job));
  const on = (j: unknown) => send(j);
  job.events.on("update", on);
  req.raw.on("close", () => job.events.off("update", on));
});
app.get<{ Params: { id: string; "*": string }; Querystring: { download?: string } }>("/files/:id/*", async (req, reply) => {
  const f = projectFile(req.params.id, req.params["*"]);
  if (req.query.download !== undefined) reply.header("content-disposition", `attachment; filename="${path.basename(f)}"`);
  return reply.type(mime(f)).send(fs.createReadStream(f));
});

// same-origin proxy to the runtime server (runtime bundle, brand CSS/fonts, content-addressed assets)
const rt = await runtimeOrigin();
for (const prefix of ["/runtime/*", "/brand/*", "/assets/*"]) {
  app.get(prefix, (req, reply) => {
    const up = http.request(rt.origin + req.url, (r) => { reply.raw.writeHead(r.statusCode ?? 502, r.headers); r.pipe(reply.raw); });
    up.on("error", () => reply.status(502).send());
    up.end();
  });
}

if (fs.existsSync(WEB)) {
  await app.register(fastifyStatic, { root: WEB, prefix: "/" });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api") ? reply.status(404).send({ error: "not found" }) : reply.sendFile("index.html")));
} else {
  app.get("/", async () => "Web UI not built: run `pnpm studio` (builds apps/web).");
}

function mime(f: string) {
  return ({ ".mp4": "video/mp4", ".webm": "video/webm", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt", ".wav": "audio/wav", ".json": "application/json" } as Record<string, string>)[path.extname(f).toLowerCase()] ?? "application/octet-stream";
}

await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`video-studio: http://127.0.0.1:${PORT}`);
