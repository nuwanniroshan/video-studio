import { z } from "zod";
import { asset, text, toggle } from "../fields.ts";
import { defineScene } from "./def.ts";

export const logoReveal = defineScene({
  type: "logoReveal",
  version: 1,
  schema: z.object({
    logo: asset("Logo", { help: "Defaults to the brand kit logo." }).optional(),
    tagline: text("Tagline", 60).optional(),
    sheen: toggle("Sheen sweep", true),
    flare: toggle("Flare line", true),
    glow: toggle("Glow", true),
  }),
  meta: { label: "Logo reveal", category: "title", description: "Blur-in logo with sheen sweep, flare line, glow and an optional tagline.",
    defaultMusicCue: "reveal", defaultTransition: { type: "flash" } },
  timing: (p) => ({ min: p.tagline ? 4.2 : 3.2 }),
  example: { tagline: "One workspace, for every team." },
  stress: { tagline: "A tagline that uses every one of its sixty characters fully" },
});
