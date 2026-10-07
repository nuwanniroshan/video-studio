/*
 * Player runtime. Served over http://127.0.0.1 (never file://). The renderer and the web preview
 * both drive it through window.__vs.
 */
import { createTimeline, type Timeline } from "@vs/engine";
import { SPRITE, registry, type AnimCtx, type Orient } from "@vs/scenes";
import { fitText } from "./fit.ts";
import { installGuards } from "./guards.ts";
import { lintScene, lintTimeline } from "./lint.ts";
import { applyTransition, visibility } from "./transitions.ts";
import type { LintIssue, LoadOptions, LoadResult, RuntimeDoc } from "./types.ts";

let tl: Timeline | null = null;
let doc: RuntimeDoc | null = null;
let guarded = false;

const orientOf = (w: number, h: number): Orient => (w > h ? "landscape" : w < h ? "portrait" : "square");

async function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  await new Promise<void>((res, rej) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.onload = () => res();
    l.onerror = () => rej(new Error("stylesheet failed: " + href));
    document.head.append(l);
  });
}

async function load(d: RuntimeDoc, opt: LoadOptions = {}): Promise<LoadResult> {
  doc = d;
  if (!guarded) { installGuards(d.seed ?? 1); guarded = true; }
  document.documentElement.style.setProperty("--stage-w", d.width + "px");
  document.documentElement.style.setProperty("--stage-h", d.height + "px");
  await loadCss(d.brandCss);
  await Promise.all(["vs-display", "vs-body", "vs-mono"].flatMap((f) => [400, 500, 600].map((w) => document.fonts.load(`${w} 40px "${f}"`))));

  const stage = document.getElementById("stage")!;
  stage.innerHTML = SPRITE;
  const orient = orientOf(d.width, d.height);
  stage.dataset.orient = orient;
  stage.dataset.aspect = d.aspect;
  const safe = d.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
  // scenes lay out inside the variant's safe area (e.g. Reels UI bands) via these variables
  stage.style.setProperty("--sa-t", `${safe.top * 100}cqh`);
  stage.style.setProperty("--sa-r", `${safe.right * 100}cqw`);
  stage.style.setProperty("--sa-b", `${safe.bottom * 100}cqh`);
  stage.style.setProperty("--sa-l", `${safe.left * 100}cqw`);
  const lint: LintIssue[] = [];
  tl = createTimeline();
  const url = (p: string) => (/^(https?:|data:|\/)/.test(p) ? p : d.brandBase + p);
  const brand = d.brand ?? { name: "", logoOnDark: "", logoOnLight: "" };

  const idx = d.scenes.map((_, i) => i).filter((i) => !opt.only || opt.only.includes(d.scenes[i].id));
  const roots = new Map<number, HTMLElement>();
  const ctxs = new Map<number, AnimCtx>();
  for (const i of idx) {
    const s = d.scenes[i];
    const next = d.scenes[i + 1];
    ctxs.set(i, {
      id: s.id,
      end: s.end - s.start,
      vo: s.vo.map((v) => ({ ...v, t: v.t - s.start })),
      steps: s.steps.map((st) => ({ start: st.start - s.start, end: st.end - s.start })),
      cues: Object.fromEntries(Object.entries(s.cues).map(([k, v]) => [k, v - s.start])),
      inT: s.transitionIn ? { start: s.transitionIn.start - s.start, end: s.transitionIn.end - s.start } : null,
      outT: next?.transitionIn ? { start: next.transitionIn.start - s.start, end: next.transitionIn.end - s.start } : null,
      tone: s.tone, aspect: d.aspect, orient, stage: { w: d.width, h: d.height }, url, brand,
    });
    const root = document.createElement("div");
    root.className = `scene tone-${s.tone} scene-${s.type}`;
    root.dataset.scene = s.id;
    stage.append(root);
    roots.set(i, root);
  }
  const flash = document.createElement("div");
  flash.className = "flash";
  stage.append(flash);

  // 1) mount while everything is displayed and untransformed, then measure + lint (pitfall 6)
  for (const i of idx) {
    const s = d.scenes[i];
    const mod = registry[s.type];
    if (!mod) { lint.push({ level: "error", scene: s.id, code: "unknown-scene", message: `unknown scene type ${s.type}` }); continue; }
    await mod.mount(roots.get(i)!, s.props as never, { ...ctxs.get(i)!, fitText });
  }
  await document.fonts.ready;
  await Promise.all([...stage.querySelectorAll("img")].map((im) => im.decode().catch(() => undefined)));
  for (const i of idx) lint.push(...lintScene(d.scenes[i].id, roots.get(i)!, { w: d.width, h: d.height }, safe));

  // 2) animation: each scene on its own scoped clock; transitions on the root timeline
  tl.hide(flash);
  for (const i of idx) {
    const s = d.scenes[i];
    const next = d.scenes[i + 1];
    const vin = s.transitionIn ? visibility(s.transitionIn.type, s.transitionIn.start, s.transitionIn.end).inFrom : s.start;
    const vout = next?.transitionIn ? visibility(next.transitionIn.type, next.transitionIn.start, next.transitionIn.end).outUntil : s.end;
    const last = i === d.scenes.length - 1;
    const sc = tl.scope(s.start, { id: s.id, start: vin, end: last ? Infinity : vout, root: roots.get(i)! });
    sc.window(roots.get(i)!, vin - s.start, last ? Infinity : vout - s.start);
    registry[s.type]?.animate(sc, s.props as never, ctxs.get(i)!);
    const prev = roots.get(i - 1);
    if (s.transitionIn && prev) {
      applyTransition(s.transitionIn.type, { tl: sc, out: prev, inn: roots.get(i)!, start: s.transitionIn.start - s.start,
        end: s.transitionIn.end - s.start, direction: s.transitionIn.direction, stage: { w: d.width, h: d.height }, flash });
    } else if (s.transitionIn?.type === "flash") {
      // segment render of the incoming scene alone: still draw the flash tail
      applyTransition("flash", { tl: sc, out: roots.get(i)!, inn: roots.get(i)!, start: s.transitionIn.start - s.start,
        end: s.transitionIn.end - s.start, stage: { w: d.width, h: d.height }, flash });
    }
  }
  lint.push(...lintTimeline(tl, d));
  tl.seek(0);
  return { duration: d.duration, markers: tl.markers(), lint, warnings: tl.warnings() };
}

/** For frames i in [0, n): true if frame i equals frame i−1 (static-frame dedupe). */
function staticFrames(t0: number, n: number, fps: number, sub: number, shutter: number): boolean[] {
  const out: boolean[] = [];
  const half = sub > 1 ? shutter / fps / 2 : 0;
  for (let i = 0; i < n; i++) {
    if (i === 0) { out.push(false); continue; }
    out.push(!tl!.activity(t0 + (i - 1) / fps - half, t0 + i / fps + half));
  }
  return out;
}

declare global {
  interface Window { __vs: unknown; __ready: Promise<void> }
}

window.__vs = {
  load,
  seek: (t: number) => tl!.seek(t),
  markers: () => tl!.markers(),
  staticFrames,
  doc: () => doc,
};
window.__ready = Promise.resolve();
