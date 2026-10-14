import { z } from "zod";

export const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;
export const Aspect = z.enum(ASPECTS);
export type Aspect = z.infer<typeof Aspect>;
export const STAGE: Record<Aspect, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 }, "9:16": { w: 1080, h: 1920 }, "1:1": { w: 1080, h: 1080 }, "4:5": { w: 1080, h: 1350 },
};

export const MUSIC_CUES = ["tension", "build", "reveal", "groove", "breath", "resolve"] as const;
export const MusicCue = z.enum(MUSIC_CUES);
export type MusicCue = z.infer<typeof MusicCue>;

export const TONES = ["light", "dark", "brand"] as const;
export const Tone = z.enum(TONES);
export type Tone = z.infer<typeof Tone>;

export const TRANSITIONS = ["cut", "crossfade", "push", "iris", "flash"] as const;
export const TRANSITION_DEFAULT_DURATION: Record<(typeof TRANSITIONS)[number], number> = {
  cut: 0, crossfade: 0.6, push: 0.7, iris: 1.0, flash: 0.9,
};
export const TransitionSpec = z.object({
  type: z.enum(TRANSITIONS).meta({ ui: "select", label: "Transition" }),
  duration: z.number().min(0).max(3).optional().meta({ ui: "number", label: "Duration (s)" }),
  direction: z.enum(["up", "down", "left", "right"]).optional().meta({ ui: "select", label: "Direction" }),
});
export type TransitionSpec = z.infer<typeof TransitionSpec>;

export const SAFE_AREAS = {
  none: { top: 0, right: 0, bottom: 0, left: 0 },
  /** Title-safe 5% inset. */
  title: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  /** Reels/TikTok/Shorts UI: top bar, right action rail, bottom caption block. */
  reels: { top: 0.11, right: 0.14, bottom: 0.2, left: 0.06 },
} as const;
export type SafeAreaName = keyof typeof SAFE_AREAS;
