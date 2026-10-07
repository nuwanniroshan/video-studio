import { z } from "zod";
import { list, num, richText, text } from "../fields.ts";
import { defineScene } from "./def.ts";

export const statsCounter = defineScene({
  type: "statsCounter",
  version: 1,
  schema: z.object({
    kicker: text("Kicker", 32).optional(),
    headline: richText("Headline", 60).optional(),
    stats: list("Stats", z.object({
      value: num("Value"),
      decimals: z.number().int().min(0).max(2).default(0).meta({ ui: "number", label: "Decimals" }),
      prefix: text("Prefix", 3).optional(),
      suffix: text("Suffix", 4).optional(),
      label: text("Label", 36),
    }), 1, 4),
  }),
  meta: { label: "Stats counter", category: "proof", description: "Up to four numbers that count up, with labels.",
    defaultMusicCue: "groove", defaultTransition: { type: "crossfade" } },
  timing: (p) => ({ min: 3.2 + 0.2 * p.stats.length }),
  example: {
    kicker: "Early access results", headline: "Faster pay runs, *fewer errors.*",
    stats: [
      { value: 82, suffix: "%", label: "less time per pay run" },
      { value: 4.9, decimals: 1, suffix: "/5", label: "average admin rating" },
      { value: 0, label: "late payments since launch" },
    ],
  },
  stress: {
    kicker: "A long stats kicker label too", headline: "A headline that is as long as allowed *by the schema*",
    stats: Array.from({ length: 4 }, () => ({ value: 1234567, prefix: "AU$", suffix: "/mo", label: "A label close to the thirty-six max" })),
  },
});
