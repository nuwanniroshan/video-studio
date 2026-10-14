import { z } from "zod";
import { richText, select, text, toggle } from "../fields.ts";
import { defineScene, words } from "./def.ts";

export const kineticTitle = defineScene({
  type: "kineticTitle",
  version: 1,
  schema: z.object({
    kicker: text("Kicker", 32, { help: "Small mono label above the headline." }).optional(),
    headline: richText("Headline", 70),
    sub: text("Sub-line", 120).optional(),
    style: select("Motion", ["rise", "mask", "typewriter", "scale"], "rise"),
    align: select("Alignment", ["center", "left"], "center"),
    exit: toggle("Animate out at the end", true),
  }),
  meta: { label: "Kinetic title", category: "title", description: "Kicker, headline and sub-line with word-level motion. Hooks and act titles.",
    defaultMusicCue: "build", defaultTransition: { type: "crossfade" } },
  timing: (p) => ({ min: 2.2 + 0.055 * words(p.headline) + (p.sub ? 1.0 : 0) }),
  example: { kicker: "New in LuraPlus", headline: "Payroll, *done in minutes.*", sub: "Run every pay cycle from the same place you manage your people.", style: "rise" },
  stress: { kicker: "A very long kicker label here", headline: "An unusually long headline that pushes the text fitter *to its limit*", sub: "A sub-line that is also as long as it is allowed to be, so the layout lint has to prove it still fits.", style: "rise" },
});
