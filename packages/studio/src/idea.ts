/*
 * Free-text idea → structured Brief, with no LLM. Used to give every new project a complete first draft
 * straight away (and as the whole result when no AI agent is available). The agent then rewrites it.
 */
import type { Brief, Goal } from "./brief.ts";

export interface IdeaInput {
  idea: string;
  name?: string;          // product / company
  audience?: string;
  points?: string[];
  cta?: string;
  url?: string;
  length?: number;
  formats?: string[];
  music?: string;
  voice?: string;
  screenshots?: string[];
  /** story shape chosen by the user (else guessed from the text) */
  goal?: Goal;
}

const split = (s: string) => s.replace(/\s+/g, " ").match(/[^.!?]+[.!?]?/g)?.map((x) => x.trim()).filter((x) => x.length > 2) ?? [];
const clean = (s: string) => s.replace(/^[-*•\d.)\s]+/, "").replace(/[.!?;:,]+$/, "").trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function guessGoal(text: string, length?: number): Goal {
  const t = text.toLowerCase();
  if (/\b(how to|how-to|step[- ]by[- ]step|tutorial|walk ?through|guide|onboard)/.test(t)) return "explainer";
  if ((length ?? 99) <= 15 || /\b(teaser|reel|tiktok|shorts|story ad)\b/.test(t)) return "social";
  if (/\b(launch|introduc|new feature|now available|just shipped|release|unveil)/.test(t)) return "launch";
  if (/\b(announc|we're opening|we are opening|news|event|webinar|hiring|join us|milestone|anniversary)/.test(t)) return "announcement";
  return "promo";
}

function guessName(text: string): string | undefined {
  const lead = text.match(/^([A-Z][\w+&.-]*(?:\s+[A-Z][\w+&.-]*){0,2})\s+(?:is|are|helps|lets|makes|gives|turns|brings|keeps)\b/);
  if (lead) return lead[1];
  const m = text.match(/\b(?:for|called|named|meet|introducing|launching|about)\s+([A-Z][\w+&.-]*(?:\s+[A-Z][\w+&.-]*){0,2})/);
  if (m) return m[1].replace(/[.,]$/, "");
  const caps = text.match(/(?<![.!?]\s|^)\b([A-Z][a-z]+[A-Z]\w*|[A-Z]{2,}[a-z]*\w*)\b/);
  return caps?.[1];
}

export function ideaToBrief(i: IdeaInput): Brief {
  const text = i.idea.trim();
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^([-*•]|\d+[.)])\s+/.test(l)).map(clean);
  const prose = lines.filter((l) => !/^([-*•]|\d+[.)])\s+/.test(l)).join(" ");
  const sentences = split(prose).map(clean).filter(Boolean);
  const goal = i.goal ?? guessGoal(text, i.length);
  const name = i.name?.trim() || guessName(text) || "Your product";
  const problemIdx = sentences.findIndex((s) => /\b(tired|struggl|hard|painful|waste|wasting|still|manual|spreadsheet|chaos|slow|frustrat|problem|without)\b/i.test(s));
  const problem = problemIdx >= 0 && goal !== "explainer" && goal !== "announcement" ? sentences[problemIdx] : undefined;
  const rest = sentences.filter((_, k) => k !== problemIdx);
  const message = rest[0] ?? sentences[0] ?? name;
  let points = (i.points?.length ? i.points : bullets).map(clean).filter(Boolean);
  if (!points.length) points = rest.slice(1, 5).map((s) => s.split(/,\s*(?:and\s+)?|\s+and\s+/)[0]).map(clean).filter((s) => s.split(" ").length <= 9);
  if (!points.length) points = rest.slice(1, 4);
  const statM = text.match(/(\$|€|£)?\s?(\d+(?:\.\d+)?)\s?(%|x|×|\+|k|m| hours?| minutes?| days?)?\s+([a-z][^.,;!?]{3,40})/i);
  const stat = statM && +statM[2] > 1 ? { value: +statM[2], prefix: statM[1] || undefined, suffix: statM[3] ? statM[3].replace(/^ /, " ") : undefined, label: clean(statM[4]) } : undefined;
  const length = ([15, 30, 45, 60] as const).reduce((a, b) => (Math.abs(b - (i.length ?? 30)) < Math.abs(a - (i.length ?? 30)) ? b : a));
  return {
    goal, product: name, message: cap(clean(message)), problem: problem ? cap(problem) : undefined, audience: i.audience,
    points: points.slice(0, goal === "social" ? 2 : 4).map((t) => ({ title: cap(t) })),
    stat, cta: i.cta?.trim() || (goal === "announcement" ? "Learn more" : goal === "explainer" ? "Try it now" : "Get started"),
    url: i.url, mood: i.music === "calm-explainer" ? "calm" : "energetic", length,
    formats: i.formats as Brief["formats"], screenshots: i.screenshots, voice: i.voice,
  };
}
