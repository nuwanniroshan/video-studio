import type { SceneModule } from "./types.ts";
import { kineticTitle } from "./kineticTitle.ts";
import { logoReveal } from "./logoReveal.ts";
import { featureSpotlight } from "./featureSpotlight.ts";
import { featureGrid } from "./featureGrid.ts";
import { screenFlow } from "./screenFlow.ts";
import { statsCounter } from "./statsCounter.ts";
import { mediaBroll } from "./mediaBroll.ts";
import { ctaEndCard } from "./ctaEndCard.ts";
import { spikeStress } from "./spikeStress.ts";

export * from "./types.ts";
export * from "./parts.ts";
export * from "./text.ts";
export { SPRITE } from "./icons.ts";

export const registry: Record<string, SceneModule> = {
  kineticTitle, logoReveal, featureSpotlight, featureGrid, screenFlow, statsCounter, mediaBroll, ctaEndCard,
  spikeStress, // render-cost probe, not in the public catalog
};
