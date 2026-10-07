import type { Aspect, Tone } from "@vs/scenes";

/** What the player mounts. In M1 this is produced from a spec by packages/timing. */
export interface RuntimeScene {
  id: string;
  type: string;
  start: number;
  end: number;
  tone: Tone;
  props: Record<string, unknown>;
  vo: { id: string; t: number; dur: number }[];
  steps: { start: number; end: number }[];
  cues: Record<string, number>;
  transitionIn?: { type: string; start: number; end: number; params?: Record<string, unknown> } | null;
}
export interface RuntimeDoc {
  aspect: Aspect;
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** URL of the generated brand stylesheet, e.g. /brand/luraplus/brand.css */
  brandCss: string;
  brandBase: string;
  seed?: number;
  safeArea?: { top: number; right: number; bottom: number; left: number };
  scenes: RuntimeScene[];
}
export interface LintIssue { level: "error" | "warning"; scene: string; code: string; message: string }
export interface LoadResult { duration: number; markers: { kind: string; t: number; scope: string; data?: unknown }[]; lint: LintIssue[]; warnings: string[] }
