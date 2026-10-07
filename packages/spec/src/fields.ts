/*
 * Field helpers. Every field carries `.meta({ ui, label, help, maxChars, group })` (PLAN §5.3):
 * the web inspector builds its forms from it, and layout lint checks `maxChars` at render time.
 */
import { z } from "zod";

export type UiKind =
  | "text" | "richText" | "number" | "color" | "asset" | "assetList" | "list" | "select" | "toggle"
  | "hotspots" | "cursorPath" | "focusRect" | "uiKit";
export interface FieldMeta { ui: UiKind; label: string; help?: string; maxChars?: number; group?: string }

const withMeta = <T extends z.ZodType>(s: T, m: FieldMeta) => s.meta(m as unknown as Record<string, unknown>) as T;

/** Plain text. `*word*` marks the two-tone accent where the scene supports it. */
export const text = (label: string, maxChars: number, o: Partial<FieldMeta> = {}) =>
  withMeta(z.string().min(1), { ui: "text", label, maxChars, ...o });
export const richText = (label: string, maxChars: number, o: Partial<FieldMeta> = {}) =>
  withMeta(z.string().min(1), { ui: "richText", label, maxChars, help: "Wrap words in *asterisks* for the accent colour.", ...o });
export const toggle = (label: string, def: boolean, o: Partial<FieldMeta> = {}) =>
  withMeta(z.boolean().default(def), { ui: "toggle", label, ...o });
export const select = <const T extends readonly [string, ...string[]]>(label: string, values: T, def: T[number], o: Partial<FieldMeta> = {}) =>
  withMeta(z.enum(values).default(def as never), { ui: "select", label, ...o });
export const num = (label: string, o: Partial<FieldMeta> & { min?: number; max?: number } = {}) => {
  let s = z.number();
  if (o.min !== undefined) s = s.min(o.min);
  if (o.max !== undefined) s = s.max(o.max);
  return withMeta(s, { ui: "number", label, help: o.help, group: o.group });
};

/** Asset reference: content address `sha256:<hex>` or a path relative to the spec file. */
export const AssetRef = z.string().regex(/^(sha256:[0-9a-f]{64}|(?!\/)(?!.*\.\.)[\w./ -]+\.(png|jpe?g|webp|svg|gif|mp4|mov|webm|wav|mp3|m4a))$/i,
  "asset must be sha256:<hex> or a relative file path");
export const asset = (label: string, o: Partial<FieldMeta> = {}) => withMeta(AssetRef, { ui: "asset", label, ...o });

export const ICONS = [
  "home", "brief", "users", "cal", "clock", "target", "chart", "gear", "search", "bell", "check", "lock", "unlock",
  "spark", "file", "shield", "arrow", "key", "list", "wallet", "box", "flag", "cycle", "msg", "policy", "copy",
] as const;
export const icon = (label = "Icon") => withMeta(z.enum(ICONS), { ui: "select", label });

/** Normalized point on a screenshot (0..1). */
export const Point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
/** Normalized rect on a screenshot (0..1): x, y, w, h. */
export const Rect = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) });

export const list = <T extends z.ZodType>(label: string, item: T, min: number, max: number, o: Partial<FieldMeta> = {}) =>
  withMeta(z.array(item).min(min).max(max), { ui: "list", label, ...o });
