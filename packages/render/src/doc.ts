import fs from "node:fs";
import path from "node:path";
import { SAFE_AREAS } from "@vs/spec";
import type { ResolvedTimeline } from "@vs/timing";
import type { RuntimeDoc } from "@vs/runtime";
import { runtimeDist } from "@vs/runtime/paths";
import { sha256 } from "@vs/storage";
import { assetUrlProps, type Project } from "./project.ts";

export function buildDoc(p: Project, r: ResolvedTimeline): RuntimeDoc {
  const v = p.spec.variants.find((x) => x.id === r.variant)!;
  const base = `/brand/${p.brand.id}/`;
  return {
    aspect: r.aspect, width: r.width, height: r.height, fps: r.fps, duration: r.duration,
    brandCss: `${base}brand.css`, brandBase: base,
    brand: { name: p.brand.name, logoOnDark: base + p.brand.logo.onDark, logoOnLight: base + p.brand.logo.onLight, ctaUrl: p.brand.cta?.url },
    safeArea: { ...SAFE_AREAS[v.safeArea] },
    scenes: r.scenes.map((s) => ({
      id: s.id, type: s.type, start: s.start, end: s.end, tone: s.tone,
      props: assetUrlProps(p, s.type, s.props),
      vo: s.vo.map((x) => ({ id: x.id, t: x.t, dur: x.dur })),
      steps: s.steps, cues: s.cues, transitionIn: s.transitionIn,
    })),
  };
}

let rtHash: string | null = null;
/** Hash of the built runtime bundle + styles (part of every segment key). */
export function runtimeHash(): string {
  if (!rtHash) {
    const files = ["runtime.js", "base.css", "scenes.css", "index.html"].map((f) => fs.readFileSync(path.join(runtimeDist, f)));
    rtHash = sha256(Buffer.concat(files));
  }
  return rtHash;
}
