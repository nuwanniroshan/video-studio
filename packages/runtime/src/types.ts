import type { Aspect, Tone } from "@vs/scenes";

/** What the player mounts: a ResolvedTimeline (packages/timing) plus brand and asset URLs. */
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
  transitionIn?: { type: string; start: number; end: number; direction?: string } | null;
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
  brand?: { name: string; logoOnDark: string; logoOnLight: string; ctaUrl?: string };
  seed?: number;
  /** Fractions of the stage kept clear of text. */
  safeArea?: { top: number; right: number; bottom: number; left: number };
  scenes: RuntimeScene[];
}
export interface LoadOptions { /** Mount only these scenes (segment renders). */ only?: string[] }
export interface LintIssue { level: "error" | "warning"; scene: string; code: string; message: string }
export interface Marker { kind: string; t: number; scope: string; data?: unknown }
export interface LoadResult { duration: number; markers: Marker[]; lint: LintIssue[]; warnings: string[] }
