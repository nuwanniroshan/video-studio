/** Brand colour derivation: five base colours in, the full token set the scenes use out. */
const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
/** Mix a towards b by t (0..1). */
export const mix = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };

export interface BaseColors { primary: string; accent: string; dark: string; light: string; ink: string }

export function deriveColors(b: BaseColors): Record<string, string> {
  const W = "#FFFFFF", K = "#000000";
  const grey = (t: number) => mix(b.light, b.ink, t);
  return {
    primary: b.primary,
    primary400: mix(b.primary, W, 0.18), primary600: mix(b.primary, K, 0.12), primary700: mix(b.primary, K, 0.28),
    primary50: mix(b.primary, W, 0.9), primary100: mix(b.primary, W, 0.8), primary200: mix(b.primary, W, 0.6),
    accent: b.accent, accent50: mix(b.accent, W, 0.9),
    success: "#1FA463", success600: "#178551", success50: "#E8F6EF",
    warning: "#E0900F", warning600: "#B9730A", warning50: "#FBF1E1",
    danger: "#E5484D", danger50: "#FCECEC",
    ink: b.ink,
    grey900: grey(0.95), grey800: grey(0.86), grey700: grey(0.76), grey600: grey(0.64), grey500: grey(0.52), grey400: grey(0.36),
    grey300: grey(0.2), grey200: grey(0.11), grey100: grey(0.06), grey50: b.light, grey25: mix(b.light, W, 0.6),
    dark: b.dark, light: b.light,
  };
}

/** Readable text colour on a background. */
export function onColor(bg: string) {
  const [r, g, bl] = hex(bg).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl > 0.4 ? "#0E1116" : "#FFFFFF";
}
