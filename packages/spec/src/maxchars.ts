import { z } from "zod";
import { catalog } from "./scenes/index.ts";

export interface CharIssue { path: string; length: number; maxChars: number }

/** Walks a scene's props against its schema's `.meta({ maxChars })` hints (layout lint, PLAN §7.6). */
export function maxCharsIssues(type: string, props: unknown): CharIssue[] {
  const def = catalog[type];
  if (!def) return [];
  const out: CharIssue[] = [];
  walk(def.schema, props, "", out);
  return out;
}

function walk(s: z.ZodType, v: unknown, path: string, out: CharIssue[]) {
  if (v === undefined || v === null) return;
  const meta = s.meta() as { maxChars?: number } | undefined;
  const d = (s as any)._zod.def;
  if (typeof v === "string" && meta?.maxChars) {
    const len = v.replace(/\*/g, "").length;
    if (len > meta.maxChars) out.push({ path, length: len, maxChars: meta.maxChars });
    return;
  }
  switch (d.type) {
    case "optional": case "default": case "nullable": case "prefault": case "readonly":
      return walk(d.innerType, v, path, out);
    case "object":
      for (const [k, child] of Object.entries(d.shape as Record<string, z.ZodType>)) walk(child, (v as any)[k], path ? `${path}.${k}` : k, out);
      return;
    case "array":
      (v as unknown[]).forEach((x, i) => walk(d.element, x, `${path}.${i}`, out));
      return;
    case "union":
      for (const o of d.options as z.ZodType[]) if (o.safeParse(v).success) return walk(o, v, path, out);
      return;
  }
}
