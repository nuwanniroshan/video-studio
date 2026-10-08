/*
 * The video agent: an AI model that writes and refines a project's storyboard through the same MCP tools
 * Claude uses in Claude Code / Desktop (apps/mcp), looking at rendered contact sheets as it goes.
 * Optional: without a provider, new projects keep the rule-written first draft (createVideoProject).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { claudeCode, type AgentEvent, type AgentProvider } from "@vs/ai";
import { REPO } from "@vs/render";
import { StudioError, cacheDir, pdir, studioHome } from "./errors.ts";

export interface AgentStep { at: number; kind: "info" | "tool" | "say" | "sheet" | "error" | "done"; text: string; detail?: string; tool?: string; ok?: boolean; image?: string }
export interface AgentJob {
  id: string; project: string; mode: "create" | "revise"; instruction: string; model: string;
  status: "running" | "done" | "error" | "stopped"; steps: AgentStep[]; summary?: string; revisions: number;
  started: number; finished?: number; costUsd?: number; events: EventEmitter; abort: AbortController;
}
const jobs = new Map<string, AgentJob>();
export const publicAgentJob = (j: AgentJob) => { const { events, abort, ...rest } = j; void events; void abort; return rest; };
export const getAgentJob = (id: string) => jobs.get(id);
export function listAgentJobs(project: string) {
  const live = [...jobs.values()].filter((j) => j.project === project).map(publicAgentJob);
  const dir = path.join(pdir(project), "agent");
  const saved = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) : [];
  const ids = new Set(live.map((j) => j.id));
  return [...live, ...saved.filter((j) => !ids.has(j.id))].sort((a, b) => b.started - a.started);
}

const provider: AgentProvider = claudeCode;
let cached: { at: number; v: { available: boolean; detail: string } } | null = null;
export async function agentStatus() {
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), v: await provider.status() };
  return { provider: provider.id, label: provider.label, ...cached.v,
    models: [{ id: "sonnet", label: "Fast (Sonnet)" }, { id: "opus", label: "Best quality (Opus)" }] };
}

const TOOLS = ["get_spec", "list_scenes", "get_scene_schema", "update_spec", "check_timing", "render_stills", "get_brand", "list_themes", "set_brand"];
const DENY = ["render_video", "render_status", "list_outputs", "create_project", "list_projects", "list_templates", "add_asset"];
const q = (s: string) => `mcp__video-studio__${s}`;

export const AGENT_SYSTEM = `You are the video agent inside a motion-graphics video studio. You write and refine one project's storyboard
(a JSON spec of scenes with voice-over) using the video-studio tools, then check it visually. The person you work for is not technical:
never mention JSON, specs, tools or file paths in your final message, and write it as plain text (no markdown).

Workflow:
1. get_spec (the current storyboard, its formats and uploaded images) and list_scenes. Use get_scene_schema for every scene type you use.
2. Write the storyboard and save it with update_spec (the whole spec). Fix every validation issue it returns and save again.
3. check_timing. Fix every lint issue (shorten text, split a scene) and any duration far from the target.
4. render_stills and LOOK at the contact sheet: wrapped or orphaned headline words, empty or lopsided areas, overlaps, text near edges,
   visuals out of order with the voice-over. Fix and re-check until it looks premium. Two review rounds are usually enough.
5. Your LAST message is shown to the user as-is: only 2–4 plain sentences on what the video says, how long it runs, and anything they
   could add (e.g. real screenshots). Do your review thinking in earlier messages, not in the last one.

Writing rules:
- Scenes have no durations; each lasts as long as its voice-over (~2.3 words per second; aim for ~70% of the runtime as speech).
- Voice-over must match what is on screen, in the same order. The on-screen text must tell the story with the sound off.
- Headlines 3–8 words, with the payoff in *asterisks* (accent colour): one contiguous phrase, usually at the end. Respect maxChars limits.
- Never repeat a stat's number in that scene's headline; the headline gives the meaning, the counter gives the number.
- Tones: dark for the problem/hook, brand moments and the CTA; light for product and benefits; "brand" (primary colour) sparingly for a big moment.
- Transitions: flash into a logo reveal, iris into the first light scene and into the CTA, crossfade or push between product scenes.
- Always end on ctaEndCard. Use a logoReveal early unless the video is 15 s or shorter.
- In featureGrid and screenFlow give voice-over lines "step": n so each item lands as it is spoken.
- Use the uploaded images (the spec's assets list) where they fit: featureSpotlight (visual.kind "image") or screenFlow for screenshots, mediaBroll for photos.
  Never invent image paths; without images use icons, stats, typography and featureSpotlight with a non-image visual.
- Keep scene ids short lowercase-dashed and unique. Keep the spec's brand, voice, music and variants (formats) unless the user asks to change them.
  For several formats, keep one storyboard; drop optional scenes in short vertical cuts with a variant scene list only if needed for length.
- Say "AI", not "A.I.". Do not render the final video; the user does that.`;

function createPrompt(project: string) {
  const d = pdir(project);
  const req = fs.existsSync(path.join(d, "request.json")) ? JSON.parse(fs.readFileSync(path.join(d, "request.json"), "utf8")) : {};
  const kit = JSON.parse(fs.readFileSync(path.join(d, "brand", "brand.json"), "utf8"));
  const lines = [
    `Project id: "${project}". Brand: ${kit.name}${kit.cta?.url ? ` (${kit.cta.url})` : ""}.`,
    req.template ? `The project starts from the "${req.template}" template. Keep its structure where it fits, and rewrite all words for this idea.`
      : `The current storyboard is a rough rule-based draft: rewrite it freely (scene choice, order and every word).`,
    "", "The user's idea:", `"""${(req.idea ?? "").trim() || "(none given: adapt the template to the brand)"}"""`,
  ];
  if (req.audience) lines.push(`Audience: ${req.audience}`);
  if (req.points?.length) lines.push(`Key points: ${req.points.join("; ")}`);
  if (req.cta) lines.push(`Call to action (button): ${req.cta}`);
  if (req.tone) lines.push(`Tone: ${req.tone}`);
  lines.push(`Target length: about ${req.length ?? 30} seconds.`, `Formats: ${(req.formats ?? ["16:9"]).join(", ")}.`);
  if (req.screenshots?.length) lines.push(`Uploaded images to use: ${req.screenshots.join(", ")}.`);
  lines.push("", "Make the best possible video for this idea, then give me your short summary.");
  return lines.join("\n");
}
const revisePrompt = (project: string, instruction: string) =>
  `Project id: "${project}". The user reviewed the video and asks:\n"""${instruction.trim()}"""\n\nRead the current storyboard, make the change (and only what it needs), check timing and look at the stills, then summarise what you changed in 1–3 sentences.`;

const SCENE: Record<string, string> = { kineticTitle: "title", logoReveal: "logo reveal", featureSpotlight: "feature spotlight", featureGrid: "feature grid",
  screenFlow: "screen flow", statsCounter: "stats", mediaBroll: "photo", ctaEndCard: "call-to-action" };
function describeTool(name: string, input: any): string {
  switch (name) {
    case "get_spec": return "Reading the storyboard";
    case "list_scenes": return "Browsing the scene library";
    case "get_scene_schema": return `Checking the ${SCENE[input?.type] ?? input?.type} scene`;
    case "update_spec": return `Writing the storyboard (${input?.spec?.scenes?.length ?? "?"} scenes)`;
    case "check_timing": return "Timing the voice-over and checking the layout";
    case "render_stills": return "Rendering frames to review";
    case "get_brand": case "list_themes": return "Looking at the brand";
    case "set_brand": return "Updating the brand";
    default: return name;
  }
}
function describeResult(name: string, ok: boolean, text: string): string | undefined {
  if (!ok) return name === "update_spec" ? "Found problems; fixing them" : `Problem: ${text.slice(0, 160)}`;
  try {
    const j = JSON.parse(text);
    if (name === "update_spec") return `Saved (revision ${j.revision})`;
    if (name === "check_timing") return `${Math.round(j.duration)} s · ${j.scenes.length} scenes · ${j.lint.length ? `${j.lint.length} layout issue${j.lint.length > 1 ? "s" : ""}` : "no layout issues"}`;
  } catch { /* not json */ }
  if (name === "render_stills") return /lint: clean/.test(text) ? "Frames rendered; layout clean" : "Frames rendered";
  return undefined;
}

/** Start the agent on a project ("create": write the storyboard from the request; "revise": apply an instruction). */
export function startAgent(project: string, o: { mode: "create" | "revise"; instruction?: string; model?: string }): AgentJob {
  const d = pdir(project);
  if ([...jobs.values()].some((j) => j.project === project && j.status === "running")) throw new StudioError(409, "the agent is already working on this video");
  if (o.mode === "revise" && !o.instruction?.trim()) throw new StudioError(400, "tell the agent what to change");
  const job: AgentJob = { id: `${project}-ag-${Date.now().toString(36)}`, project, mode: o.mode, instruction: o.instruction ?? "", model: o.model ?? process.env.VS_AGENT_MODEL ?? "sonnet",
    status: "running", steps: [], revisions: 0, started: Date.now(), events: new EventEmitter(), abort: new AbortController() };
  job.events.setMaxListeners(50);
  jobs.set(job.id, job);
  const emit = () => job.events.emit("update", publicAgentJob(job));
  const step = (s: Omit<AgentStep, "at">) => { job.steps.push({ at: Date.now(), ...s }); emit(); };
  const pending = new Map<string, number>();
  step({ kind: "info", text: o.mode === "create" ? "Starting the agent" : `Working on: “${o.instruction!.trim().slice(0, 140)}”` });

  const onEvent = (e: AgentEvent) => {
    if (e.kind === "start") { if (!e.tools.includes("update_spec")) step({ kind: "error", text: "The studio tools did not connect" }); return; }
    if (e.kind === "say") return step({ kind: "say", text: e.text });
    if (e.kind === "tool") { pending.set(e.id, job.steps.length); return step({ kind: "tool", tool: e.name, text: describeTool(e.name, e.input) }); }
    if (e.kind === "tool-result") {
      const i = pending.get(e.id);
      const s = i !== undefined ? job.steps[i] : undefined;
      if (s) { s.ok = e.ok; s.detail = describeResult(e.name, e.ok, e.text); }
      if (e.name === "update_spec" && e.ok) job.revisions++;
      if (e.name === "render_stills" && e.ok) {
        const st = path.join(d, "out", "stills");
        const since = s?.at ?? 0;
        const sheets = fs.existsSync(st) ? fs.readdirSync(st).filter((f) => f.endsWith("-sheet.jpg") && fs.statSync(path.join(st, f)).mtimeMs >= since - 1000) : [];
        for (const f of sheets) step({ kind: "sheet", text: "Contact sheet", image: `/files/${project}/out/stills/${f}?v=${Date.now()}` });
      }
      emit();
      return;
    }
    if (e.kind === "error") return step({ kind: "error", text: e.text });
  };

  const mcpEnv = { VS_STUDIO_HOME: studioHome(), VS_CACHE: cacheDir(), PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  provider.run({
    prompt: o.mode === "create" ? createPrompt(project) : revisePrompt(project, o.instruction!),
    system: AGENT_SYSTEM, model: job.model, cwd: path.join(studioHome()), signal: job.abort.signal,
    mcpServers: { "video-studio": { command: process.execPath, args: [path.join(REPO, "apps/mcp/bin/server.mjs")], env: mcpEnv } },
    allowedTools: TOOLS.map(q), disallowedTools: DENY.map(q), onEvent,
  }).then((r) => {
    job.costUsd = (r as { costUsd?: number }).costUsd;
    job.status = job.abort.signal.aborted ? "stopped" : r.ok ? "done" : "error";
    // the last message, minus any review notes before a "---" divider
    job.summary = r.text.split(/\n-{3,}\n/).pop()!.trim();
    step({ kind: job.status === "done" ? "done" : "error", text: job.status === "done" ? "Finished" : job.status === "stopped" ? "Stopped" : "The agent stopped with a problem", detail: r.ok ? undefined : r.text.slice(0, 300) });
  }).catch((e) => { job.status = "error"; step({ kind: "error", text: (e as Error).message }); })
    .finally(() => {
      job.finished = Date.now();
      fs.mkdirSync(path.join(d, "agent"), { recursive: true });
      fs.writeFileSync(path.join(d, "agent", `${job.id}.json`), JSON.stringify(publicAgentJob(job), null, 1));
      emit();
    });
  return job;
}

export function stopAgent(id: string) {
  const j = jobs.get(id);
  if (!j) throw new StudioError(404, "no such agent run");
  j.abort.abort();
  return publicAgentJob(j);
}
