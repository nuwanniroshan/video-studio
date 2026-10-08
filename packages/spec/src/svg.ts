/*
 * Inline SVG drawn by the agent (compose scene). Only plain vector markup is allowed: no scripts, event
 * handlers, external references, embedded HTML or raster images. The runtime also strips anything outside
 * this allowlist before mounting, so a spec edited by hand cannot reach the network or run code.
 */
export const SVG_TAGS = new Set([
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "lineargradient", "radialgradient",
  "stop", "clippath", "mask", "title", "desc", "text", "tspan", "use", "symbol",
]);
export const SVG_MAX = 24000;

/** Why the markup is not allowed, or null when it is fine. */
export function svgIssue(s: string): string | null {
  if (s.length > SVG_MAX) return `SVG is longer than ${SVG_MAX} characters`;
  if (!/^\s*<svg[\s>]/i.test(s)) return "SVG must start with <svg";
  if (/<\s*script|<\s*foreignobject|<\s*image|<\s*iframe|<\s*style/i.test(s)) return "SVG may not contain script, style, image, iframe or foreignObject";
  if (/\son[a-z]+\s*=/i.test(s)) return "SVG may not contain event handlers";
  if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(s)) return "SVG links may only point inside the SVG (#id)";
  if (/url\(\s*["']?(?!#)/i.test(s)) return "SVG url() may only reference ids inside the SVG";
  if (/javascript:|data:/i.test(s)) return "SVG may not contain javascript: or data: URLs";
  for (const m of s.matchAll(/<\s*([a-zA-Z][\w:-]*)/g)) if (!SVG_TAGS.has(m[1].toLowerCase())) return `SVG element <${m[1]}> is not allowed`;
  return null;
}
