import type { SceneModule } from "./types.ts";
import { kineticTitle } from "./kineticTitle.ts";
import { spikeStress } from "./spikeStress.ts";

export * from "./types.ts";
export * from "./motion.ts";
export * from "./text.ts";

export const registry: Record<string, SceneModule> = {
  kineticTitle,
  spikeStress,
};
