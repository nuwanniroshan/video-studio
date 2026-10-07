/*
 * Player runtime. Served over http://127.0.0.1 (never file://). The renderer and the web preview
 * both drive it through window.__vs.
 */
import { createTimeline, type Timeline } from "@vs/engine";
import { registry, type AnimCtx, type Orient } from "@vs/scenes";
import { fitText } from "./fit.ts";
import { installGuards } from "./guards.ts";
import { lintScene } from "./lint.ts";
import type { LintIssue, LoadResult, RuntimeDoc } from "./types.ts";

let tl: Timeline | null = null;
let doc: RuntimeDoc | null = null;

const orientOf = (w: number, h: number): Orient => (w > h ? "landscape" : w < h ? "portrait" : "square");

async function loadCss(href: string) {
  await new Promise<void>((res, rej) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.onload = () => res();
    l.onerror = () => rej(new Error("stylesheet failed: " + href));
    document.head.append(l);
  });
}

function buildBackground(stage: HTMLElement) {
  const bg = document.createElement("div");
  bg.id = "bg";
  bg.innerHTML =
    '<div class="layer bg-dark"><div class="layer grid-dark"></div></div>' +
    '<div class="layer bg-light"><div class="layer grid-light"></div><div class="orb orb-a"></div><div class="orb orb-b"></div><div class="layer vignette-light"></div></div>';
  stage.append(bg);
  return { light: bg.querySelector<HTMLElement>(".bg-light")!, orbA: bg.querySelector<HTMLElement>(".orb-a")!, orbB: bg.querySelector<HTMLElement>(".orb-b")! };
}

async function load(d: RuntimeDoc): Promise<LoadResult> {
  doc = d;
  installGuards(d.seed ?? 1);
  document.documentElement.style.setProperty("--stage-w", d.width + "px");
  document.documentElement.style.setProperty("--stage-h", d.height + "px");
  await loadCss(d.brandCss);
  await Promise.all(["vs-display", "vs-body", "vs-mono"].flatMap((f) => [400, 600].map((w) => document.fonts.load(`${w} 40px "${f}"`))));

  const stage = document.getElementById("stage")!;
  stage.innerHTML = "";
  const orient = orientOf(d.width, d.height);
  stage.dataset.orient = orient;
  stage.dataset.aspect = d.aspect;
  const bg = buildBackground(stage);
  const safe = d.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const lint: LintIssue[] = [];
  tl = createTimeline();
  const url = (p: string) => (/^(https?:|data:|\/)/.test(p) ? p : d.brandBase + p);

  // 1) mount every scene while all are displayed and untransformed, then measure + lint (pitfall 6)
  const roots: HTMLElement[] = [];
  const ctxs: AnimCtx[] = [];
  d.scenes.forEach((s, i) => {
    const next = d.scenes[i + 1];
    const ctx: AnimCtx = {
      id: s.id,
      end: s.end - s.start,
      vo: s.vo.map((v) => ({ ...v, t: v.t - s.start })),
      steps: s.steps.map((st) => ({ start: st.start - s.start, end: st.end - s.start })),
      cues: Object.fromEntries(Object.entries(s.cues).map(([k, v]) => [k, v - s.start])),
      inT: s.transitionIn ? { start: s.transitionIn.start - s.start, end: s.transitionIn.end - s.start } : null,
      outT: next?.transitionIn ? { start: next.transitionIn.start - s.start, end: next.transitionIn.end - s.start } : null,
      tone: s.tone,
      aspect: d.aspect,
      orient,
      stage: { w: d.width, h: d.height },
      url,
    };
    const root = document.createElement("div");
    root.className = `scene tone-${s.tone} scene-${s.type}`;
    root.dataset.scene = s.id;
    stage.append(root);
    roots.push(root);
    ctxs.push(ctx);
  });
  for (let i = 0; i < d.scenes.length; i++) {
    const s = d.scenes[i];
    const mod = registry[s.type];
    if (!mod) {
      lint.push({ level: "error", scene: s.id, code: "unknown-scene", message: `unknown scene type ${s.type}` });
      continue;
    }
    await mod.mount(roots[i], s.props as never, { ...ctxs[i], fitText });
  }
  await document.fonts.ready;
  await Promise.all([...stage.querySelectorAll("img")].map((im) => im.decode().catch(() => undefined)));
  for (let i = 0; i < d.scenes.length; i++) lint.push(...lintScene(d.scenes[i].id, roots[i], { w: d.width, h: d.height }, safe));

  // 2) register animation, scene by scene, each on its own scoped clock
  d.scenes.forEach((s, i) => {
    const ctx = ctxs[i];
    const visA = s.transitionIn ? Math.min(s.start, s.transitionIn.start) : s.start;
    const next = d.scenes[i + 1];
    const visB = next?.transitionIn ? Math.max(s.end, next.transitionIn.end) : s.end;
    const sc = tl!.scope(s.start, { id: s.id, start: visA, end: visB, root: roots[i] });
    sc.window(roots[i], visA - s.start, i === d.scenes.length - 1 ? Infinity : visB - s.start);
    registry[s.type]?.animate(sc, s.props as never, ctx);
    // background tone
    const light = s.tone === "light" ? 1 : 0;
    const tA = s.transitionIn ? s.transitionIn.start - s.start : 0;
    const tD = s.transitionIn ? Math.max(0.3, s.transitionIn.end - s.transitionIn.start) : 0.0001;
    if (i === 0) tl!.initial(bg.light, { o: light });
    else sc.tw(bg.light, tA, tD, null, { o: light }, "inOut");
    if (s.tone === "light") {
      const k = 0.35;
      sc.fn(visA - s.start, visB - visA, (_p, t) => {
        bg.orbA.style.transform = `translate3d(${(Math.sin(t * k) * 60).toFixed(2)}px,${(Math.cos(t * k * 0.8) * 40).toFixed(2)}px,0)`;
        bg.orbB.style.transform = `translate3d(${(Math.cos(t * k * 0.7) * 70).toFixed(2)}px,${(Math.sin(t * k * 0.9) * 50).toFixed(2)}px,0)`;
      }, { ease: "linear", continuous: true, key: "orbs" });
    }
  });
  tl.seek(0);
  return { duration: d.duration, markers: tl.markers(), lint, warnings: tl.warnings() };
}

/** For frames i in [i0, i1): true if the frame equals the previous one (static-frame dedupe). */
function staticFrames(t0: number, n: number, fps: number, sub: number, shutter: number): boolean[] {
  const out: boolean[] = [];
  const half = sub > 1 ? shutter / fps / 2 : 0;
  for (let i = 0; i < n; i++) {
    if (i === 0) { out.push(false); continue; }
    const a = t0 + (i - 1) / fps - half, b = t0 + i / fps + half;
    out.push(!tl!.activity(a, b));
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
