import { z } from "zod";
import { asset, list, richText, select, text } from "../fields.ts";
import { defineScene, words } from "./def.ts";

const PanelRow = z.object({
  label: text("Label", 36),
  value: text("Value", 24).optional(),
  status: z.enum(["none", "ok", "warn", "info", "new"]).default("none").meta({ ui: "select", label: "Status" }),
});

export const featureSpotlight = defineScene({
  type: "featureSpotlight",
  version: 1,
  schema: z.object({
    kicker: text("Kicker", 32).optional(),
    headline: richText("Headline", 60),
    body: text("Body", 160).optional(),
    bullets: list("Bullets", text("Bullet", 48), 0, 4).optional(),
    visual: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("image"), asset: asset("Screenshot or image"), frame: z.enum(["browser", "none"]).default("browser").meta({ ui: "select", label: "Frame" }) }),
      z.object({
        kind: z.literal("panel"),
        title: text("Panel title", 32),
        rows: list("Rows", PanelRow, 1, 6),
        action: text("Button", 20).optional(),
      }),
    ]).meta({ ui: "uiKit", label: "Visual" }),
    layout: select("Layout", ["auto", "split-left", "split-right", "stacked", "visual-only"], "auto",
      { help: "auto = split-left in landscape, stacked in portrait." }),
  }),
  meta: { label: "Feature spotlight", category: "feature", description: "Copy column beside a product visual (screenshot or data panel).",
    defaultMusicCue: "groove", defaultTransition: { type: "push", direction: "left" } },
  timing: (p) => ({ min: 3.4 + 0.04 * words(p.headline) + 0.5 * (p.bullets?.length ?? 0) + (p.body ? 0.8 : 0) }),
  example: {
    kicker: "Payroll", headline: "Run payroll *in minutes.*", body: "Hours, leave and allowances flow straight from timesheets.",
    bullets: ["Auto-calculated tax", "One-click approvals"],
    visual: { kind: "panel", title: "October pay run", rows: [
      { label: "Employees", value: "128", status: "none" }, { label: "Timesheets approved", value: "128/128", status: "ok" },
      { label: "Leave adjustments", value: "6", status: "info" }, { label: "Total gross", value: "$412,380", status: "none" },
    ], action: "Approve pay run" },
  },
  stress: {
    kicker: "A long feature kicker label", headline: "A headline that is as long as allowed *by the schema*",
    body: "Body copy at its maximum length so the copy column has to wrap across several lines and still fit within its box on every aspect ratio.",
    bullets: ["Bullet number one, close to max length", "Bullet two, also close to max length", "Bullet three, near the forty-eight limit", "Bullet four, the last allowed bullet"],
    visual: { kind: "panel", title: "A panel title near its limit", rows: [
      { label: "A long row label near thirty-six ch", value: "A long value text", status: "ok" },
      { label: "Second row label", value: "$1,234,567.89", status: "warn" }, { label: "Third", value: "3", status: "new" },
      { label: "Fourth", status: "none" }, { label: "Fifth", value: "5", status: "info" }, { label: "Sixth", value: "6", status: "ok" },
    ], action: "A long action" },
  },
});
