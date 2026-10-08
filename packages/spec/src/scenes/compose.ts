/*
 * compose: a free-form scene built from layers (text, shapes, agent-drawn SVG, images, icons, particles,
 * counters) placed on a percentage grid and animated with motion presets against the scene's own cues.
 * It is how the agent designs original layouts instead of filling a fixed scene; everything stays
 * declarative, so layout lint, golden frames and the editor still apply.
 */
import { z } from "zod";
import { ICONS, asset, list, num, richText, select, text, toggle } from "../fields.ts";
import { svgIssue } from "../svg.ts";
import { defineScene, words } from "./def.ts";

export const COLOR_TOKENS = ["auto", "primary", "primary-light", "primary-dark", "primary-soft", "accent", "accent-soft",
  "ink", "dark", "light", "muted", "white", "black"] as const;
const Color = (label: string, def = "auto") => z.string().regex(new RegExp(`^(#[0-9a-fA-F]{6}|${COLOR_TOKENS.join("|")})$`), "a brand token (primary, accent, ink…) or #RRGGBB")
  .default(def).meta({ ui: "color", label, help: `${COLOR_TOKENS.join(", ")} or #RRGGBB.` });
const OptColor = (label: string) => z.string().regex(new RegExp(`^(#[0-9a-fA-F]{6}|${COLOR_TOKENS.join("|")})$`), "a brand token (primary, accent, ink…) or #RRGGBB")
  .optional().meta({ ui: "color", label });

/** A cue the layer starts at: "start", "end" or one of the scene's voice-over line ids (v1, v2… or the line's own id). */
const Cue = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "start, end or a voice-over line id (v1, v2…)");

export const ENTERS = ["rise", "fade", "drop", "left", "right", "scale", "pop", "zoom", "blur", "wipe", "reveal", "iris",
  "draw", "words", "letters", "typewriter", "none"] as const;
export const LOOPS = ["none", "float", "sway", "spin", "pulse", "drift", "breathe"] as const;
export const ANCHORS = ["center", "top-left", "top", "top-right", "left", "right", "bottom-left", "bottom", "bottom-right"] as const;

const Place = z.object({
  x: num("X %", { min: -50, max: 150 }).optional(),
  y: num("Y %", { min: -50, max: 150 }).optional(),
  w: num("Width %", { min: 0.5, max: 200 }).optional(),
  h: num("Height %", { min: 0.2, max: 200 }).optional(),
  size: num("Text size ×", { min: 0.3, max: 3 }).optional(),
  anchor: z.enum(ANCHORS).optional().meta({ ui: "select", label: "Anchor" }),
  align: z.enum(["left", "center", "right"]).optional().meta({ ui: "select", label: "Text align" }),
}).meta({ label: "Placement override" });

const base = {
  name: z.string().max(40).optional().meta({ ui: "text", label: "Layer name", help: "Only for you; not shown." }),
  x: num("X %", { min: -50, max: 150, help: "Position of the anchor, as % of the safe frame width (0 = left edge)." }).default(50),
  y: num("Y %", { min: -50, max: 150, help: "% of the safe frame height (0 = top)." }).default(50),
  w: num("Width %", { min: 0.5, max: 200 }).optional(),
  h: num("Height %", { min: 0.2, max: 200 }).optional(),
  anchor: select("Anchor", ANCHORS, "center"),
  rotate: num("Rotate °", { min: -360, max: 360 }).default(0),
  opacity: num("Opacity", { min: 0, max: 1 }).default(1),
  at: Cue.default("start").meta({ ui: "text", label: "Starts at", help: "start, end or a voice-over line id (v1, v2…)." }),
  delay: num("Delay (s)", { min: -5, max: 30 }).default(0),
  enter: select("Entrance", ENTERS, "rise"),
  speed: num("Entrance length ×", { min: 0.3, max: 4 }).default(1),
  until: Cue.optional().meta({ ui: "text", label: "Leaves at", help: "Optional cue at which the layer animates out." }),
  loop: select("Idle motion", LOOPS, "none"),
  portrait: Place.optional(),
  square: Place.optional(),
};

export const TEXT_STYLES = ["display", "headline", "title", "body", "label", "quote", "stat"] as const;
const TextLayer = z.object({
  kind: z.literal("text"),
  text: richText("Text", 160),
  style: select("Style", TEXT_STYLES, "headline"),
  size: num("Size ×", { min: 0.3, max: 3 }).default(1),
  font: select("Font", ["auto", "display", "body", "mono"], "auto"),
  weight: select("Weight", ["auto", "300", "400", "500", "600", "700", "800", "900"], "auto"),
  color: Color("Colour"),
  accent: Color("Accent colour", "auto"),
  align: select("Align", ["center", "left", "right"], "center"),
  italic: toggle("Italic", false),
  caps: toggle("Uppercase", false),
  tracking: num("Letter spacing (em)", { min: -0.1, max: 0.6 }).optional(),
  deco: select("Decoration", ["none", "underline", "marker", "pill", "box"], "none"),
  decoColor: Color("Decoration colour", "primary"),
  ...base,
});
const ShapeLayer = z.object({
  kind: z.literal("shape"),
  shape: select("Shape", ["rect", "circle", "pill", "line", "ring", "arc", "triangle", "blob"], "rect"),
  fill: Color("Fill", "primary"),
  fill2: OptColor("Gradient to"),
  gradientAngle: num("Gradient angle °", { min: 0, max: 360 }).default(135),
  stroke: OptColor("Outline"),
  strokeWidth: num("Outline width (px at 1080)", { min: 0, max: 60 }).default(4),
  radius: num("Corner radius %", { min: 0, max: 50 }).default(4),
  shadow: toggle("Shadow", false),
  ...base,
});
const SvgLayer = z.object({
  kind: z.literal("svg"),
  svg: z.string().min(10).superRefine((s, c) => { const e = svgIssue(s); if (e) c.addIssue({ code: "custom", message: e }); })
    .meta({ ui: "code", label: "SVG markup", help: "Plain vector markup (paths, shapes, gradients). Use currentColor or var(--vs-primary) for brand colours." }),
  color: Color("Colour (currentColor)", "primary"),
  ...base,
});
const ImageLayer = z.object({
  kind: z.literal("image"),
  src: asset("Image"),
  fit: select("Fit", ["cover", "contain"], "cover"),
  frame: select("Frame", ["none", "rounded", "card", "polaroid", "circle", "browser", "phone"], "rounded"),
  zoom: select("Slow zoom", ["none", "in", "out"], "in"),
  focusX: num("Focus X", { min: 0, max: 1 }).default(0.5),
  focusY: num("Focus Y", { min: 0, max: 1 }).default(0.5),
  ...base,
});
const IconLayer = z.object({
  kind: z.literal("icon"),
  icon: z.enum(ICONS).meta({ ui: "select", label: "Icon" }),
  color: Color("Colour", "primary"),
  badge: OptColor("Badge background"),
  ...base,
});
const LogoLayer = z.object({
  kind: z.literal("logo"),
  version: select("Version", ["auto", "on-dark", "on-light"], "auto", { help: "auto picks the logo made for the scene's tone." }),
  ...base,
});
const ParticlesLayer = z.object({
  kind: z.literal("particles"),
  style: select("Style", ["steam", "bubbles", "sparkles", "confetti", "dust", "snow", "embers", "petals"], "dust"),
  color: Color("Colour", "auto"),
  color2: OptColor("Second colour"),
  count: z.number().int().min(3).max(40).default(16).meta({ ui: "number", label: "Count" }),
  ...base,
});
const CounterLayer = z.object({
  kind: z.literal("counter"),
  value: z.number().meta({ ui: "number", label: "Number" }),
  from: num("Counts from").default(0),
  decimals: z.number().int().min(0).max(3).default(0).meta({ ui: "number", label: "Decimals" }),
  prefix: text("Prefix", 4).optional(),
  suffix: text("Suffix", 8).optional(),
  style: select("Style", TEXT_STYLES, "stat"),
  size: num("Size ×", { min: 0.3, max: 3 }).default(1),
  color: Color("Colour", "auto"),
  countFor: num("Count duration (s)", { min: 0.3, max: 6 }).default(1.6),
  ...base,
});

export const Layer = z.discriminatedUnion("kind", [TextLayer, ShapeLayer, SvgLayer, ImageLayer, IconLayer, LogoLayer, ParticlesLayer, CounterLayer])
  .meta({ label: "Layer" });

const Background = z.object({
  style: select("Background", ["tone", "solid", "linear", "radial", "spotlight", "split", "none"], "tone",
    { help: "tone = the house background for the scene's tone." }),
  colors: list("Colours", Color("Colour", "primary"), 0, 3).optional(),
  angle: num("Angle °", { min: 0, max: 360 }).default(160),
  motif: select("Pattern", ["none", "grid", "dots", "lines", "rings", "waves", "grain"], "none"),
  motifColor: Color("Pattern colour", "auto"),
  motifOpacity: num("Pattern strength", { min: 0, max: 1 }).default(0.5),
  vignette: toggle("Vignette", false),
}).meta({ label: "Background" });

export const compose = defineScene({
  type: "compose",
  version: 1,
  schema: z.object({
    background: Background.default({ style: "tone", angle: 160, motif: "none", motifColor: "auto", motifOpacity: 0.5, vignette: false }),
    camera: select("Camera", ["none", "push-in", "pull-out", "pan-left", "pan-right", "rise", "drift"], "none"),
    layers: list("Layers", Layer, 1, 28, { help: "Drawn in order: the first layer is at the back." }),
    exit: toggle("Animate out at the end", true),
  }),
  meta: { label: "Composed scene", category: "custom",
    description: "Free-form layout: you place layers (text, shapes, your own SVG illustrations, images, the logo, icons, particles, counters) on a % grid of the safe frame and give each an entrance at a voice-over cue. Use it to design original scenes that fit the idea instead of a fixed layout.",
    defaultMusicCue: "build", defaultTransition: { type: "crossfade" } },
  timing: (p) => ({ min: 2.4 + 0.045 * p.layers.reduce((n: number, l: { kind: string; text?: string }) => n + (l.kind === "text" ? words(l.text) : 0), 0) }),
  example: {
    background: { style: "radial", colors: ["#3B2416", "#140B07"], motif: "grain", motifOpacity: 0.35, vignette: true },
    camera: "push-in",
    layers: [
      { kind: "shape", shape: "circle", x: 72, y: 52, w: 34, fill: "primary", fill2: "accent", opacity: 0.22, enter: "scale", loop: "breathe",
        portrait: { x: 50, y: 34, w: 80 } },
      { kind: "svg", x: 72, y: 56, w: 22, h: 30, color: "#F3E3CF", enter: "draw", speed: 1.6,
        svg: '<svg viewBox="0 0 120 140" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 52h70v34a30 30 0 0 1-30 30h-10a30 30 0 0 1-30-30z"/><path d="M88 62h8a14 14 0 0 1 0 28h-8"/><path d="M10 124h100"/></svg>',
        portrait: { x: 50, y: 36, w: 46, h: 26 } },
      { kind: "particles", style: "steam", x: 70, y: 30, w: 16, h: 26, color: "#F3E3CF", count: 7, at: "start", delay: 0.6,
        portrait: { x: 49, y: 16, w: 34, h: 16 } },
      { kind: "text", style: "label", text: "Since 2009", x: 8, y: 34, anchor: "left", align: "left", color: "accent", enter: "fade",
        portrait: { x: 50, y: 60, anchor: "center", align: "center" } },
      { kind: "text", style: "headline", text: "Slow mornings, *perfect pours.*", x: 8, y: 50, w: 52, anchor: "left", align: "left", enter: "words", at: "v1",
        portrait: { x: 50, y: 70, w: 90, anchor: "center", align: "center" } },
      { kind: "text", style: "body", text: "Single-origin beans, roasted on site every week.", x: 8, y: 68, w: 44, anchor: "left", align: "left", enter: "rise", at: "v1", delay: 0.8,
        portrait: { x: 50, y: 82, w: 86, anchor: "center", align: "center" } },
    ],
  },
  stress: {
    background: { style: "linear", colors: ["primary", "dark"], motif: "dots" },
    layers: [
      { kind: "text", style: "display", text: "A display line that is as long as the text field allows, testing the *fitter limits* on every aspect ratio of the stage here", x: 50, y: 30, w: 90, h: 40 },
      { kind: "text", style: "body", text: "Body copy at full length so the fitter has to shrink and wrap it across several lines inside its own box, on every aspect, without overflowing.", x: 50, y: 72, w: 80, h: 20, enter: "letters" },
      { kind: "counter", value: 12500, prefix: "$", suffix: "+", x: 50, y: 90, w: 60, h: 14 },
      { kind: "icon", icon: "spark", x: 10, y: 10, w: 8, badge: "white", loop: "spin" },
      { kind: "particles", style: "confetti", x: 50, y: 50, w: 100, h: 100, count: 40 },
    ],
  },
});
