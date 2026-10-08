/*
 * "Describe your idea": a guided brief → a complete storyboard spec, with no LLM (PLAN: the tool must work
 * without AI). The rules encode the house style (REFERENCE §3): problem on dark, product on light, brand
 * moments on dark, two-tone headlines, voice-over that matches the visual order, held CTA.
 */
import { maxCharsIssues, validateSpec } from "@vs/spec";
import { StudioError } from "./errors.ts";

export type Goal = "launch" | "promo" | "announcement" | "explainer" | "social";
export interface Brief {
  goal: Goal;
  product: string;
  message: string;              // the one thing to remember, e.g. "Payroll in minutes"
  problem?: string;             // what's painful today
  audience?: string;
  points: { title: string; detail?: string }[];   // features / benefits / steps
  stat?: { value: number; suffix?: string; prefix?: string; label: string };
  cta: string;                  // button label
  ctaLine?: string;             // closing headline
  url?: string;
  mood?: "energetic" | "calm";
  length?: 15 | 30 | 45 | 60;
  formats?: ("16:9" | "9:16" | "1:1" | "4:5")[];
  screenshots?: string[];       // project asset paths (assets/…)
  voice?: string;
}

const ICONS: [RegExp, string][] = [
  [/secur|privac|safe|protect|complian|sso|audit/i, "shield"], [/fast|speed|quick|minute|second|instant|time/i, "clock"],
  [/team|people|collab|share|everyone|staff/i, "users"], [/pay|money|cost|price|sav|budget|invoice|wallet/i, "wallet"],
  [/report|insight|analytic|dashboard|metric|data|chart/i, "chart"], [/ai|automat|smart|magic|auto/i, "spark"],
  [/calendar|schedul|date|leave|holiday|plan/i, "cal"], [/chat|messag|support|help|talk|notify/i, "msg"],
  [/doc|file|contract|record/i, "file"], [/integrat|connect|sync|api|workflow/i, "cycle"], [/goal|target|okr|focus/i, "target"],
  [/search|find/i, "search"], [/mobile|anywhere|remote|global|world/i, "flag"], [/lock|access|permission|role/i, "lock"],
];
const iconFor = (s: string) => ICONS.find(([re]) => re.test(s))?.[1] ?? "check";

/** Trim to a limit at a word boundary. */
function fit(s: string, max: number) {
  s = s.replace(/\s+/g, " ").trim().replace(/\*/g, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1).replace(/\s+\S*$/, "").replace(/[,;:–-]+$/, "");
  return cut || s.slice(0, max);
}
/** Two-tone headline: the payoff (last ~40% of words, at least one) in accent. */
function accent(s: string, max: number) {
  const t = fit(s, max);
  const w = t.split(" ");
  if (w.length < 3) return t.length + 2 <= max ? `*${t}*` : t;
  const k = Math.max(1, Math.round(w.length * 0.4));
  return `${w.slice(0, -k).join(" ")} *${w.slice(-k).join(" ")}*`;
}
const sentence = (s: string) => { const t = fit(s, 300); return /[.!?]$/.test(t) ? t : `${t}.`; };
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const listSpeech = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);

export function briefToSpec(b: Brief, brand: string): Record<string, unknown> {
  if (!b.product?.trim()) throw new StudioError(400, "Tell us the product or company name");
  if (!b.message?.trim()) throw new StudioError(400, "Add the main message");
  if (!b.cta?.trim()) throw new StudioError(400, "Add a call to action (button text)");
  const points = (b.points ?? []).filter((p) => p.title?.trim()).slice(0, 6);
  const length = b.length ?? (b.goal === "social" ? 15 : b.goal === "announcement" ? 30 : 45);
  const short = length <= 15, medium = length <= 30;
  const formats = b.formats?.length ? b.formats : b.goal === "social" ? ["9:16"] : ["16:9"];
  const product = b.product.trim();
  const shots = b.screenshots ?? [];
  const scenes: Record<string, unknown>[] = [];

  // 1) hook: the problem (dark) or the message
  if (b.problem?.trim()) {
    scenes.push({ id: "hook", type: "kineticTitle", tone: "dark", musicCue: "tension",
      vo: [{ text: sentence(b.problem) }],
      props: { kicker: b.goal === "explainer" ? "How to" : "Sound familiar?", headline: accent(b.problem, 70), style: short ? "typewriter" : "mask" } });
  } else {
    scenes.push({ id: "hook", type: "kineticTitle", tone: b.goal === "announcement" ? "brand" : "dark", musicCue: "build",
      vo: [{ text: sentence(b.goal === "announcement" ? `Big news: ${lowerFirst(b.message)}` : b.message) }],
      props: { kicker: { launch: "New", promo: product, announcement: "Announcing", explainer: "How to", social: product }[b.goal], headline: accent(b.message, 70),
        style: b.goal === "announcement" ? "scale" : "rise" } });
  }

  // 2) brand moment (not in 15 s cuts)
  if (!short) {
    scenes.push({ id: "reveal", type: "logoReveal", tone: "dark", transitionIn: { type: "flash" }, musicCue: "reveal",
      vo: [{ text: `Meet ${product}.` }], props: { tagline: accent(b.problem ? b.message : product, 60) } });
  }

  // 3) the product: screenshots → spotlight / flow; otherwise a panel of the points
  const firstLight = () => (scenes.some((s) => s.tone === "light") ? { type: "crossfade" } : { type: "iris" });
  if (b.goal === "explainer" && points.length) {
    if (shots.length) {
      const steps = points.slice(0, Math.min(points.length, shots.length, 5));
      scenes.push({ id: "steps", type: "screenFlow", tone: "light", transitionIn: firstLight(), musicCue: "groove",
        vo: steps.map((p, i) => ({ text: sentence(`${["First", "Next", "Then", "After that", "Finally"][i === steps.length - 1 && i > 0 ? 4 : i]}, ${lowerFirst(p.title)}`), step: i })),
        props: { kicker: "Step by step", title: fit(b.message, 60), steps: steps.map((p, i) => ({ screen: shots[i], caption: fit(`${i + 1} · ${p.title}`, 60) })) } });
    } else {
      scenes.push({ id: "steps", type: "featureGrid", tone: "light", transitionIn: firstLight(), musicCue: "groove",
        vo: points.slice(0, 6).map((p, i) => ({ text: sentence(`${["First", "Next", "Then", "Then", "After that", "Finally"][i]}, ${lowerFirst(p.title)}`), step: i })),
        props: { kicker: "Step by step", headline: accent(b.message, 60),
          items: points.slice(0, 6).map((p, i) => ({ icon: iconFor(p.title + " " + (p.detail ?? "")), title: fit(`${i + 1}. ${p.title}`, 28), ...(p.detail ? { text: fit(p.detail, 80) } : {}) })) } });
    }
  } else if (!short) {
    const lead = points[0];
    const visual = shots.length
      ? { kind: "image", asset: shots[0], frame: "browser" }
      : { kind: "panel", title: fit(product, 32), rows: (points.length ? points : [{ title: b.message }]).slice(0, 5).map((p) => ({ label: fit(p.title, 36), status: "ok" })) };
    scenes.push({ id: "spotlight", type: "featureSpotlight", tone: "light", transitionIn: firstLight(), musicCue: "groove",
      vo: [{ text: sentence(lead?.detail ? `${b.message}. ${lead.detail}` : b.message) }],
      props: { kicker: { launch: "What's new", promo: "Why it matters", announcement: "What's changing", explainer: "Overview", social: "Why" }[b.goal],
        headline: accent(b.message, 60), ...(lead?.detail ? { body: fit(lead.detail, 160) } : {}),
        ...(points.length > 1 && !medium ? { bullets: points.slice(1, 4).map((p) => fit(p.title, 48)) } : {}), visual } });
  }

  // 4) benefits grid (when there's more than a single point)
  if (b.goal !== "explainer" && points.length >= 2 && (!short || points.length >= 3)) {
    const items = points.slice(0, medium ? 3 : 4);
    const bound = length >= 45;
    scenes.push({ id: "benefits", type: "featureGrid", tone: "light", transitionIn: { type: "push", direction: "left" }, musicCue: "groove",
      vo: bound ? items.map((p, i) => ({ text: sentence(p.detail ? `${p.title}: ${lowerFirst(p.detail)}` : p.title), step: i }))
        : [{ text: sentence(listSpeech(items.map((p, i) => (i ? lowerFirst(p.title) : p.title)))) }],
      props: { kicker: b.audience ? fit(`For ${b.audience}`, 32) : "Built in", headline: accent(b.goal === "launch" ? `Everything ${product} gives you` : "Why teams choose it", 60),
        items: items.map((p) => ({ icon: iconFor(p.title + " " + (p.detail ?? "")), title: fit(p.title, 28), ...(p.detail ? { text: fit(p.detail, 80) } : {}) })) } });
  }

  // 5) proof
  if (b.stat && b.stat.label?.trim() && (length >= 30 || b.goal === "social")) {
    const v = b.stat.value;
    const spoken = `${b.stat.prefix ?? ""}${v}${b.stat.suffix?.trim() === "%" ? " percent" : b.stat.suffix ?? ""}`;
    scenes.push({ id: "proof", type: "statsCounter", tone: b.goal === "social" ? "brand" : "light", transitionIn: { type: b.goal === "social" ? "flash" : "crossfade" },
      musicCue: "build", optional: length >= 45,
      vo: [{ text: sentence(`${spoken} ${b.stat.label}`) }],
      props: { ...(b.goal === "social" ? {} : { kicker: "The results" }), stats: [{ value: v, decimals: Number.isInteger(v) ? 0 : 1,
        ...(b.stat.prefix ? { prefix: fit(b.stat.prefix, 3) } : {}), ...(b.stat.suffix ? { suffix: fit(b.stat.suffix, 4) } : {}), label: fit(b.stat.label, 36) }] } });
  }

  // 6) the close
  scenes.push({ id: "cta", type: "ctaEndCard", tone: "dark", transitionIn: { type: "iris" }, musicCue: "resolve",
    vo: [{ text: `${product}.` }, { text: sentence(b.ctaLine ? b.ctaLine : `${b.cta} today`) }],
    props: { headline: accent(b.ctaLine ?? b.message, 60), button: fit(b.cta, 24), ...(b.url ? { url: fit(b.url, 40) } : {}) } });

  const variants = formats.map((a, i) => ({
    id: i === 0 ? "main" : { "16:9": "landscape", "9:16": "vertical", "1:1": "square", "4:5": "feed" }[a],
    aspect: a, safeArea: a === "9:16" ? "reels" : "title", ...(a === "9:16" || a === "1:1" || a === "4:5" ? { loudness: -14 } : {}),
  }));
  const spec = {
    version: 1, title: fit(`${product}: ${b.message}`, 120), brand, fps: 60, quality: "standard",
    music: b.mood === "calm" || b.goal === "explainer" ? { mode: "preset", preset: "calm-explainer" } : { mode: "preset", preset: "uplifting-tech", bpm: 96 },
    voice: { provider: "kokoro", voice: b.voice ?? "af_heart", speed: b.goal === "social" ? 1.0 : 0.94 },
    ...(short ? { timing: { snap: "beat", leadIn: 0.3, lineGap: 0.25, tail: 0.4 } } : {}),
    variants, scenes,
  };
  const r = validateSpec(spec);
  if (!r.ok) throw new StudioError(422, "could not build a valid storyboard from this brief", r.issues);
  for (const s of r.spec.scenes) if (maxCharsIssues(s.type, s.props).length) throw new StudioError(500, `brief generator exceeded a text limit in ${s.id}`);
  return spec;
}
