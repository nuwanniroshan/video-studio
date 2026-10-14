export type Quality = "draft" | "standard" | "cinema";
export interface QualityTier { scale: number; fps: number; sub: number; capture: "png" | "jpeg"; jpegQuality?: number; crf: number }

/** PLAN §10 quality tiers; numbers confirmed in docs/SPIKE.md. */
export const QUALITY: Record<Quality, QualityTier> = {
  draft: { scale: 0.5, fps: 30, sub: 1, capture: "jpeg", jpegQuality: 85, crf: 18 },
  standard: { scale: 1, fps: 30, sub: 2, capture: "png", crf: 8 },
  cinema: { scale: 1, fps: 60, sub: 3, capture: "png", crf: 8 },
};
export const SHUTTER = 0.5; // 180°

/** Sub-frame time for output frame i, sub-sample k (REFERENCE §4.2), from absolute t so segments join seamlessly. */
export function subTime(t0: number, i: number, k: number, fps: number, sub: number, shutter = SHUTTER): number {
  return t0 + i / fps + (sub > 1 ? (k / sub) * (shutter / fps) - shutter / fps / 2 : 0);
}
