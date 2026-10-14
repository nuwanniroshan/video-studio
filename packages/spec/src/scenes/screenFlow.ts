import { z } from "zod";
import { Point, Rect, asset, list, text } from "../fields.ts";
import { defineScene } from "./def.ts";

export const screenFlow = defineScene({
  type: "screenFlow",
  version: 1,
  schema: z.object({
    kicker: text("Kicker", 32).optional(),
    title: text("Title", 60).optional(),
    steps: list("Steps", z.object({
      screen: asset("Screenshot"),
      click: Point.optional().meta({ ui: "hotspots", label: "Click point" }),
      type: text("Typed text", 40).optional(),
      caption: text("Caption", 60).optional(),
      focus: Rect.optional().meta({ ui: "focusRect", label: "Focus", help: "Portrait variants zoom to this rect." }),
    }), 1, 8),
  }),
  meta: { label: "Screen flow", category: "product", description: "Screenshots in a browser frame with a synthetic cursor moving between click points, clicks, typing and zooms.",
    defaultMusicCue: "groove", defaultTransition: { type: "crossfade" } },
  timing: (p) => ({ min: 1.0, steps: p.steps.map((s) => ({ min: 1.9 + (s.type ? 0.05 * s.type.length : 0) })) }),
  example: {
    kicker: "How it works", title: "Three clicks to pay day",
    steps: [
      { screen: "assets/flow-1.png", click: { x: 0.83, y: 0.16 }, caption: "Start a pay run", focus: { x: 0.45, y: 0.05, w: 0.55, h: 0.45 } },
      { screen: "assets/flow-2.png", click: { x: 0.8, y: 0.86 }, caption: "Review the totals", focus: { x: 0.35, y: 0.45, w: 0.65, h: 0.5 } },
      { screen: "assets/flow-3.png", caption: "Paid. Payslips sent.", focus: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } },
    ],
  },
  stress: {
    kicker: "A long screen-flow kicker label", title: "A title for the flow that is as long as it may be...",
    steps: [{ screen: "assets/flow-1.png", click: { x: 0.5, y: 0.5 }, caption: "A caption that is as long as the schema allows here" }],
  },
});
