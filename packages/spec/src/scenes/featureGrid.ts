import { z } from "zod";
import { icon, list, richText, text } from "../fields.ts";
import { defineScene } from "./def.ts";

export const featureGrid = defineScene({
  type: "featureGrid",
  version: 1,
  schema: z.object({
    kicker: text("Kicker", 32).optional(),
    headline: richText("Headline", 60).optional(),
    items: list("Items", z.object({ icon: icon(), title: text("Title", 28), text: text("Line", 80).optional() }), 2, 6),
  }),
  meta: { label: "Feature grid", category: "feature", description: "2–6 cards with icon, title and a line. VO lines can bind to items (steps).",
    defaultMusicCue: "groove", defaultTransition: { type: "crossfade" } },
  timing: (p) => ({ min: 2.4, steps: p.items.map(() => ({ min: 0.8 })) }),
  example: {
    kicker: "Why teams switch", headline: "Everything payroll needs, *built in.*",
    items: [
      { icon: "shield", title: "Compliant by default", text: "Tax tables and super rates update automatically." },
      { icon: "clock", title: "Minutes, not days", text: "Pay runs build themselves from approved timesheets." },
      { icon: "wallet", title: "Every pay type", text: "Salaries, hourly, allowances and bonuses in one run." },
    ],
  },
  stress: {
    kicker: "A long grid kicker label here", headline: "A headline that is as long as allowed *by the schema*",
    items: Array.from({ length: 6 }, (_, i) => ({ icon: "check" as const, title: `Item title near limit ${i + 1}`,
      text: "A supporting line that is close to the eighty character limit for each card." })),
  },
});
