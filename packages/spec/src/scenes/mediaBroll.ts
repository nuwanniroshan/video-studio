import { z } from "zod";
import { asset, richText, select, text, toggle } from "../fields.ts";
import { defineScene } from "./def.ts";

export const mediaBroll = defineScene({
  type: "mediaBroll",
  version: 1,
  schema: z.object({
    media: asset("Image"),
    motion: select("Ken Burns", ["in", "out", "left", "right", "none"], "in"),
    tint: select("Tint", ["none", "duotone", "darken"], "darken"),
    headline: richText("Overlay headline", 60).optional(),
    sub: text("Overlay sub-line", 100).optional(),
    position: select("Text position", ["bottom-left", "center", "top-left"], "bottom-left"),
    focusX: z.number().min(0).max(1).default(0.5).meta({ ui: "number", label: "Focus X", help: "Horizontal focal point used when cropping." }),
    vignette: toggle("Edge darkening", true),
  }),
  meta: { label: "Media B-roll", category: "media", description: "A user image with Ken Burns motion, tint and a text overlay.",
    defaultMusicCue: "groove", defaultTransition: { type: "crossfade" } },
  timing: () => ({ min: 3.0 }),
  example: { media: "assets/broll.jpg", headline: "Built for *growing teams.*", sub: "From 10 people to 1,000, without new tools." },
  stress: { media: "assets/broll.jpg", headline: "A headline that is as long as allowed *by the schema*",
    sub: "A sub-line that also uses up all of its one hundred allowed characters, to test the overlay box." },
});
