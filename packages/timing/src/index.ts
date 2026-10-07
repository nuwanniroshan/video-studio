/*
 * Timing resolver (PLAN §6): spec + VO durations + beat grid → ResolvedTimeline.
 * Pure and deterministic. Scenes animate against the cues it returns, never absolute seconds.
 */
import { STAGE, TRANSITION_DEFAULT_DURATION, catalog, effectiveScenes, type Aspect, type EffectiveScene, type MusicCue, type Spec, type Tone } from "@vs/spec";

export interface Grid { bpm: number; offset?: number; /** Detected beat times (uploaded music); overrides bpm spacing. */ beats?: number[] }
export type VoDuration = (sceneId: string, line: { id: string; text: string }) => number;

export interface ResolvedVo { id: string; text: string; t: number; dur: number; step?: number }
export interface ResolvedTransition { type: string; start: number; end: number; direction?: string }
export interface ResolvedScene {
  id: string; type: string; version: number; tone: Tone; musicCue: MusicCue; props: Record<string, unknown>;
  start: number; end: number;
  steps: { start: number; end: number }[];
  vo: ResolvedVo[];
  transitionIn: ResolvedTransition | null;
  cues: Record<string, number>;
}
export interface ResolvedTimeline {
  variant: string; aspect: Aspect; width: number; height: number; fps: number; bpm: number;
  duration: number; beats: number[]; scenes: ResolvedScene[]; dropped: string[]; warnings: string[];
}

export class TimingError extends Error {}

const EPS = 1e-6;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

function gridPoints(g: Grid, until: number, unit: "bar" | "beat"): number[] {
  if (g.beats?.length) {
    const b = g.beats.filter((x) => x >= 0);
    const pts = unit === "beat" ? b : b.filter((_, i) => i % 4 === 0);
    // extend past the last detected beat with the median spacing
    const step = pts.length > 1 ? pts[pts.length - 1] - pts[pts.length - 2] : (60 / g.bpm) * (unit === "bar" ? 4 : 1);
    const out = [...pts];
    while (out[out.length - 1] < until) out.push(out[out.length - 1] + step);
    return out;
  }
  const step = (60 / g.bpm) * (unit === "bar" ? 4 : 1);
  const off = g.offset ?? 0;
  const out: number[] = [];
  for (let k = 0; off + k * step <= until + step; k++) out.push(r6(off + k * step));
  return out;
}

function snapUp(t: number, pts: number[]): number {
  for (const p of pts) if (p >= t - EPS) return p;
  return t;
}

interface Body { len: number; vo: { id: string; text: string; rel: number; dur: number; step?: number }[]; steps: { start: number; end: number }[]; warnings: string[] }

/** Scene body length and local VO/step placement, before snapping. */
export function sceneBody(s: EffectiveScene, voDur: VoDuration, t: { leadIn: number; lineGap: number; tail: number }): Body {
  const def = catalog[s.type];
  const tm = def.timing(s.props as never);
  const userMin = s.duration.mode === "auto" ? s.duration.min ?? 0 : 0;
  const lines = s.vo.map((l) => ({ id: l.id, text: l.text, dur: voDur(s.id, l), step: l.step }));
  const warnings: string[] = [];
  const span = (ls: typeof lines) => ls.reduce((a, l) => a + l.dur, 0) + t.lineGap * Math.max(0, ls.length - 1);
  const vo: Body["vo"] = [];
  let steps: Body["steps"];
  let len: number;
  const stepMins = tm.steps?.map((x) => x.min) ?? null;

  if (stepMins && lines.some((l) => l.step !== undefined)) {
    // lines bound to steps drive step lengths
    const k = stepMins.length;
    const groups: (typeof lines)[] = Array.from({ length: k }, () => []);
    for (const l of lines) groups[Math.min(k - 1, Math.max(0, l.step ?? 0))].push(l);
    const lens = groups.map((g, i) => Math.max(stepMins[i], g.length ? span(g) + (i < k - 1 ? t.lineGap : 0) : 0));
    len = Math.max(tm.min, userMin, t.leadIn + lens.reduce((a, b) => a + b, 0) + t.tail);
    lens[k - 1] += len - (t.leadIn + lens.reduce((a, b) => a + b, 0) + t.tail);
    let c = t.leadIn;
    steps = lens.map((d) => { const st = { start: c, end: c + d }; c += d; return st; });
    groups.forEach((g, i) => {
      let at = steps[i].start;
      for (const l of g) { vo.push({ id: l.id, text: l.text, rel: at, dur: l.dur, step: i }); at += l.dur + t.lineGap; }
    });
  } else {
    const voSpan = span(lines);
    const minSteps = stepMins ? stepMins.reduce((a, b) => a + b, 0) : 0;
    len = Math.max(tm.min, userMin, t.leadIn + Math.max(voSpan, minSteps) + t.tail);
    let at = t.leadIn;
    for (const l of lines) { vo.push({ id: l.id, text: l.text, rel: at, dur: l.dur }); at += l.dur + t.lineGap; }
    if (stepMins) {
      // steps spread across the available body in proportion to their minimums
      const avail = len - t.leadIn - t.tail, tot = minSteps || 1;
      let c = t.leadIn;
      steps = stepMins.map((m) => { const d = (avail * m) / tot; const st = { start: c, end: c + d }; c += d; return st; });
    } else steps = [{ start: 0, end: len }];
  }
  if (s.duration.mode === "fixed") {
    const voEnd = vo.length ? vo[vo.length - 1].rel + vo[vo.length - 1].dur : 0;
    if (voEnd > s.duration.seconds) warnings.push(`scene "${s.id}": voice-over (${voEnd.toFixed(2)} s) overruns the fixed ${s.duration.seconds} s`);
    const scale = s.duration.seconds / len;
    if (stepMins) steps = steps.map((st) => ({ start: st.start * scale, end: st.end * scale }));
    else steps = [{ start: 0, end: s.duration.seconds }];
    len = s.duration.seconds;
  }
  return { len, vo, steps, warnings };
}

export function resolve(spec: Spec, variantId: string, voDur: VoDuration, grid?: Grid): ResolvedTimeline {
  const variant = spec.variants.find((v) => v.id === variantId);
  if (!variant) throw new TimingError(`unknown variant "${variantId}"`);
  const bpm = grid?.bpm ?? (spec.music.mode !== "none" && "bpm" in spec.music && spec.music.bpm ? spec.music.bpm : 96);
  const g: Grid = grid ?? { bpm };
  let scenes = effectiveScenes(spec, variantId);
  const dropped: string[] = [];
  let tail = spec.timing.tail;
  const attempt = () => layout(scenes, voDur, { ...spec.timing, tail }, g, spec.timing.snap);
  let res = attempt();
  if (variant.maxDuration !== undefined) {
    const max = variant.maxDuration;
    // 1) drop optional scenes, last first
    while (res.duration > max + EPS) {
      const idx = scenes.map((s) => s.optional).lastIndexOf(true);
      if (idx < 0) break;
      dropped.push(scenes[idx].id);
      scenes = scenes.filter((_, i) => i !== idx);
      if (idx === 0 && scenes.length) scenes[0] = { ...scenes[0], transitionIn: { type: "cut" } };
      res = attempt();
    }
    // 2) shorten tails
    while (res.duration > max + EPS && tail > 0.15 + EPS) {
      tail = Math.max(0.15, tail - 0.15);
      res = attempt();
    }
    if (res.duration > max + EPS)
      throw new TimingError(`variant "${variantId}" needs ${res.duration.toFixed(2)} s but maxDuration is ${max} s ` +
        `(dropped optional: ${dropped.join(", ") || "none"}). Shorten VO or remove scenes.`);
  }
  const { w, h } = STAGE[variant.aspect];
  return { variant: variantId, aspect: variant.aspect, width: w, height: h, fps: spec.fps, bpm: g.bpm, ...res, dropped };
}

function layout(scenes: EffectiveScene[], voDur: VoDuration, t: { leadIn: number; lineGap: number; tail: number }, g: Grid, snap: "bar" | "beat" | "none") {
  const bodies = scenes.map((s) => sceneBody(s, voDur, t));
  const warnings = bodies.flatMap((b) => b.warnings);
  const total = bodies.reduce((a, b) => a + b.len, 0);
  const pts = snap === "none" ? [] : gridPoints(g, total * 1.5 + 30, snap);
  const out: ResolvedScene[] = [];
  let start = 0;
  bodies.forEach((b, i) => {
    const s = scenes[i];
    const end = snap === "none" ? r6(start + b.len) : snapUp(start + b.len, pts);
    out.push({
      id: s.id, type: s.type, version: s.version, tone: s.tone, musicCue: s.musicCue, props: s.props,
      start, end,
      // snapping slack (end − start − len) goes to the last step
      steps: b.steps.map((st, k) => ({ start: r6(start + st.start), end: r6(start + st.end + (k === b.steps.length - 1 ? end - start - b.len : 0)) })),
      vo: b.vo.map((v) => ({ id: v.id, text: v.text, t: r6(start + v.rel), dur: v.dur, ...(v.step !== undefined ? { step: v.step } : {}) })),
      transitionIn: null,
      cues: {},
    });
    start = end;
  });
  // transitions overlap the boundary symmetrically, clamped to 40% of the shorter neighbour
  for (let i = 1; i < out.length; i++) {
    const tr = scenes[i].transitionIn;
    const shorter = Math.min(out[i - 1].end - out[i - 1].start, out[i].end - out[i].start);
    const d = tr.type === "cut" ? 0 : Math.min(tr.duration ?? TRANSITION_DEFAULT_DURATION[tr.type], 0.4 * shorter);
    const c = out[i].start;
    out[i].transitionIn = { type: tr.type, start: r6(c - d / 2), end: r6(c + d / 2), ...(tr.direction ? { direction: tr.direction } : {}) };
  }
  for (const s of out) {
    const c: Record<string, number> = { start: s.start, end: s.end };
    s.steps.forEach((st, k) => { c[`step.${k}`] = st.start; c[`step.${k}.end`] = st.end; });
    for (const v of s.vo) { c[`vo.${v.id}`] = v.t; c[`vo.${v.id}.end`] = r6(v.t + v.dur); }
    if (s.transitionIn) { c["in.start"] = s.transitionIn.start; c["in.end"] = s.transitionIn.end; }
    s.cues = c;
  }
  const duration = out.length ? out[out.length - 1].end : 0;
  const beats = gridPoints(g, duration, "beat").filter((b) => b <= duration + EPS);
  return { duration, scenes: out, beats, warnings };
}
