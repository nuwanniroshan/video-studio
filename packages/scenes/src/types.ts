import type { Scope } from "@vs/engine";

export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";
export type Orient = "landscape" | "portrait" | "square";
export type Tone = "light" | "dark" | "brand";
export type MusicCue = "tension" | "build" | "reveal" | "groove" | "breath" | "resolve";

export interface VoCue { id: string; t: number; dur: number }
export interface StepCue { start: number; end: number }

/** Scene-local cues: every time is in seconds from the scene's own start (t = 0). */
export interface AnimCtx {
  id: string;
  /** Local end of the scene body (its duration). */
  end: number;
  vo: VoCue[];
  steps: StepCue[];
  cues: Record<string, number>;
  /** Local times of the incoming/outgoing transition windows (if any). */
  inT: { start: number; end: number } | null;
  outT: { start: number; end: number } | null;
  tone: Tone;
  aspect: Aspect;
  orient: Orient;
  stage: { w: number; h: number };
  /** URL resolver for brand-relative and asset paths. */
  url(path: string): string;
}

export interface MountCtx extends AnimCtx {
  /** Shrink-to-fit font sizing (px bounds), called after fonts load. */
  fitText(el: HTMLElement, opt: { min: number; max: number; maxHeight?: number }): number;
}

export interface SceneModule<P = any> {
  type: string;
  version: number;
  meta: { label: string; category: string; description: string; defaultMusicCue: MusicCue };
  timing?(props: P): { min: number; steps?: { min: number }[] };
  mount(root: HTMLElement, props: P, ctx: MountCtx): void | Promise<void>;
  animate(tl: Scope, props: P, ctx: AnimCtx): void;
}
