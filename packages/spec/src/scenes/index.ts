import { kineticTitle } from "./kineticTitle.ts";
import { logoReveal } from "./logoReveal.ts";
import { featureSpotlight } from "./featureSpotlight.ts";
import { featureGrid } from "./featureGrid.ts";
import { screenFlow } from "./screenFlow.ts";
import { statsCounter } from "./statsCounter.ts";
import { mediaBroll } from "./mediaBroll.ts";
import { ctaEndCard } from "./ctaEndCard.ts";
import type { SceneDef } from "./def.ts";

export * from "./def.ts";
export { kineticTitle, logoReveal, featureSpotlight, featureGrid, screenFlow, statsCounter, mediaBroll, ctaEndCard };

export const SCENE_DEFS = [kineticTitle, logoReveal, featureSpotlight, featureGrid, screenFlow, statsCounter, mediaBroll, ctaEndCard] as const;
export const catalog: Record<string, SceneDef> = Object.fromEntries(SCENE_DEFS.map((d) => [d.type, d as unknown as SceneDef]));
export type SceneType = (typeof SCENE_DEFS)[number]["type"];
