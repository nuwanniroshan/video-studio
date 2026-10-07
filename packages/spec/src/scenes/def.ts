import type { z } from "zod";
import type { MusicCue, TransitionSpec } from "../common.ts";

export type Category = "title" | "product" | "feature" | "proof" | "structure" | "media" | "close" | "custom";

/** Node-safe half of a scene module: schema, catalog metadata and timing. DOM code lives in @vs/scenes. */
export interface SceneDef<S extends z.ZodType = z.ZodType> {
  type: string;
  version: number;
  schema: S;
  meta: { label: string; category: Category; description: string; defaultMusicCue: MusicCue; defaultTransition: TransitionSpec };
  /** Minimum body length (s) and, for multi-step scenes, per-step minimums. */
  timing(props: z.output<S>): { min: number; steps?: { min: number }[] };
  /** A complete example used for defaults, docs, the catalog and golden frames. */
  example: z.input<S>;
  /** Longest-allowed text, for the layout-lint stress fixture. */
  stress: z.input<S>;
}

export const words = (s?: string) => (s ? s.replace(/\*/g, "").trim().split(/\s+/).length : 0);
export const defineScene = <S extends z.ZodType>(d: SceneDef<S>) => d;
