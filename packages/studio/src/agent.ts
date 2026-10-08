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
import { FONT_LIBRARY } from "@vs/brand";
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
   visuals out of order with the voice-over, anything that looks generic. Fix and re-check until it looks premium. Two or three review rounds.
5. Your LAST message is shown to the user as-is: only 2–4 plain sentences on what the video says, how long it runs, and anything they
   could add (e.g. real photos). Do your review thinking in earlier messages, not in the last one.

Writing rules:
- Scenes have no durations; each lasts as long as its voice-over (~2.3 words per second; aim for ~70% of the runtime as speech).
- Voice-over must match what is on screen, in the same order. The on-screen text must tell the story with the sound off.
- Write for the subject's real world and audience: a café promo talks like a café, not like software. No SaaS clichés unless it is software.
- Headlines 3–8 words, with the payoff in *asterisks* (accent colour): one contiguous phrase, usually at the end. Respect maxChars limits.
- Never repeat a stat's number in that scene's headline; the headline gives the meaning, the counter gives the number.
- Use the uploaded images (the spec's assets list) where they fit. Never invent image paths.
- Keep scene ids short lowercase-dashed and unique. Keep the spec's voice, music and variants (formats) unless the user asks to change them.
  For several formats, keep one storyboard; drop optional scenes in short vertical cuts with a variant scene list only if needed for length.
- Say "AI", not "A.I.". Do not render the final video; the user does that.

The compose scene (your design tool): layers placed on a % grid of the safe frame (x, y = anchor position; w, h = size), drawn back to front.
- Layer kinds: text (styles display, headline, title, body, label, quote, stat), shape (rect, circle, pill, line, ring, arc, triangle, blob,
  optional gradient), svg (your own vector illustration), image, logo, icon, particles (steam, bubbles, sparkles, confetti, dust, snow,
  embers, petals) and counter. Background: tone, solid, linear, radial, spotlight or split, with an optional pattern and vignette. Camera moves.
- Timing: every layer enters at a cue (at: "start", a voice-over line id like "v2", or "end") plus delay,
  with an entrance (rise, fade, drop, left, right, scale, pop, zoom, blur, wipe, reveal, iris, draw, words, letters, typewriter).
  Bring each thing in as the voice-over mentions it; stagger related layers by 0.1–0.3 s. "until" makes a layer leave at a later cue,
  so one scene can show a sequence. "loop" adds idle motion (float, sway, spin, pulse, drift, breathe); use it on one or two layers, not all.
- SVG illustrations: simple, confident line art or flat shapes made for this subject (a cup, a leaf, a storefront, a road, a ticket…):
  a viewBox, 2–12 elements, stroke="currentColor" with fill="none" for line art (animate it with enter "draw"), or fills using currentColor /
  style="fill:var(--vs-accent)". Allowed elements: svg, g, path, circle, ellipse, rect, line, polyline, polygon, defs, gradients, stop,
  clipPath, mask, text, tspan, use, symbol. No scripts, styles, images or external links.
- Default text colours follow your background's lightness (dark background → white text). Still set the scene tone to match it:
  tone drives the house background, transitions and the music cue.
- Every layer that should sit differently on a tall screen gets a "portrait" placement (and "square" for 1:1): stack things vertically,
  text widths 80–92, sizes up. In 9:16 reels the safe frame already excludes the platform UI.
- Keep text inside the frame (x ± w/2 within 0–100 for centred layers). 3–9 layers per scene is typical.`;

const FONTS = FONT_LIBRARY.map((f) => `${f.id} (${f.family}, ${f.style}; ${f.roles.join("/")})`).join(", ");

const ORIGINAL = `This is an ORIGINAL video: no template. The current storyboard is only a rough rule-based draft; replace it completely.
Before writing anything, decide a creative direction for THIS idea and say it in a short message:
- the concept in one line, and the feeling (cosy, bold, playful, premium, urgent…);
- the visual world: motifs, illustrations, textures and shapes that belong to this subject (not generic tech grids);
- the story arc and pacing that fit (a mood piece, a countdown, a step-by-step, a before/after, a list of reasons, a manifesto…);
- how the opening hooks and how it closes (logo, offer, address, call to action — whatever the idea needs).
Then build it mostly from compose scenes so every layout is designed for this video. Vary composition from scene to scene
(asymmetric split, centred statement, full-bleed type, big number, illustration-led, image-led); never use the same layout twice in a row.
Use the fixed scene types only where they are clearly the best fit (screenFlow or featureSpotlight for real product screenshots,
ctaEndCard when a button is wanted, mediaBroll for a full-bleed photo). Transitions and tones are yours to choose; keep them purposeful.`;

const TEMPLATE = (t: string) => `The project starts from the "${t}" template. Keep its structure and scene types where they fit, and rewrite all words for this idea.
House pattern for templates: dark tone for the problem/hook, brand moments and the CTA; light for product and benefits; "brand" sparingly.
Flash into a logo reveal, iris into the first light scene and into the CTA, crossfade or push between product scenes. End on ctaEndCard.
In featureGrid and screenFlow give voice-over lines "step": n so each item lands as it is spoken. You may swap a scene for a compose scene
when the template's layout does not suit the idea.`;

function createPrompt(project: string) {
  const d = pdir(project);
  const req = fs.existsSync(path.join(d, "request.json")) ? JSON.parse(fs.readFileSync(path.join(d, "request.json"), "utf8")) : {};
  const kit = JSON.parse(fs.readFileSync(path.join(d, "brand", "brand.json"), "utf8"));
  const lines = [
    `Project id: "${project}". Brand: ${kit.name}${kit.cta?.url ? ` (${kit.cta.url})` : ""}.`,
    req.template ? TEMPLATE(req.template) : ORIGINAL,
    "", "The user's idea:", `"""${(req.idea ?? "").trim() || "(none given: adapt the template to the brand)"}"""`,
  ];
  if (req.audience) lines.push(`Audience: ${req.audience}`);
  if (req.points?.length) lines.push(`Key points: ${req.points.join("; ")}`);
  if (req.cta) lines.push(`Call to action (button): ${req.cta}`);
  if (req.tone) lines.push(`Tone: ${req.tone}`);
  lines.push(`Target length: about ${req.length ?? 30} seconds.`, `Formats: ${(req.formats ?? ["16:9"]).join(", ")}.`);
  if (req.screenshots?.length) lines.push(`Uploaded images to use: ${req.screenshots.join(", ")}.`);
  if (req.brand?.theme === "auto") lines.push("", `The user left the look to you. First call set_brand with five colours (primary, accent, dark, light, ink) and fonts
(display, body, mono) that suit the concept; keep the brand name and website. Fonts: ${FONTS}. Choose a music preset that fits too
(set_brand music: ${fs.readdirSync(path.join(REPO, "python/vsaudio/score/presets")).filter((f) => f.endsWith(".yaml")).map((f) => f.slice(0, -5)).join(", ")}). Make sure primary reads on both light and dark backgrounds.`);
  else if (!req.template) lines.push("", "The brand colours and fonts are set by the user; design within them (you may use any shade of them).");
  lines.push("", "Make the best possible video for this idea, then give me your short summary.");
  return lines.join("\n");
}
const revisePrompt = (project: string, instruction: string) =>
  `Project id: "${project}". The user reviewed the video and asks:\n"""${instruction.trim()}"""\n\nRead the current storyboard, make the change (and only what it needs), check timing and look at the stills, then summarise what you changed in 1–3 sentences.`;

const SCENE: Record<string, string> = { kineticTitle: "title", logoReveal: "logo reveal", featureSpotlight: "feature spotlight", featureGrid: "feature grid",
  screenFlow: "screen flow", statsCounter: "stats", mediaBroll: "photo", ctaEndCard: "call-to-action", compose: "composed" };
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
