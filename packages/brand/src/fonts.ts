import path from "node:path";
import { fileURLToPath } from "node:url";

/** Bundled OFL font library (packages/brand/fonts), all commercial-safe. */
export const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fonts");
export const FONT_LIBRARY = [
  { id: "onest", family: "Onest", file: "Onest.ttf", weight: "100 900", style: "Geometric sans", roles: ["display", "body"] },
  { id: "inter", family: "Inter", file: "Inter.ttf", weight: "100 900", style: "Neutral sans", roles: ["display", "body"] },
  { id: "manrope", family: "Manrope", file: "Manrope.ttf", weight: "200 800", style: "Modern sans", roles: ["display", "body"] },
  { id: "dmsans", family: "DM Sans", file: "DMSans.ttf", weight: "100 1000", style: "Friendly sans", roles: ["display", "body"] },
  { id: "sora", family: "Sora", file: "Sora.ttf", weight: "100 800", style: "Tech sans", roles: ["display"] },
  { id: "spacegrotesk", family: "Space Grotesk", file: "SpaceGrotesk.ttf", weight: "300 700", style: "Quirky grotesk", roles: ["display"] },
  { id: "playfair", family: "Playfair Display", file: "PlayfairDisplay.ttf", weight: "400 900", style: "Elegant serif", roles: ["display"] },
  { id: "opensans", family: "Open Sans", file: "OpenSans.ttf", weight: "300 800", style: "Humanist sans", roles: ["body"] },
  { id: "jetbrains", family: "JetBrains Mono", file: "JetBrainsMono.ttf", weight: "100 800", style: "Mono", roles: ["mono"] },
  { id: "plexmono", family: "IBM Plex Mono", file: "IBMPlexMono.ttf", weight: "400", style: "Mono", roles: ["mono"] },
] as const;
