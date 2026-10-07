import { z } from "zod";
import { catalog } from "./scenes/index.ts";

/** Calls `fn` for every asset field (`.meta({ ui: "asset" })`) in a scene's props; returns props with replacements. */
export function mapAssets(type: string, props: unknown, fn: (ref: string, path: string) => string): Record<string, unknown> {
  const def = catalog[type];
  if (!def) return props as Record<string, unknown>;
  return walk(def.schema, props, "", fn) as Record<string, unknown>;
}

function walk(s: z.ZodType, v: unknown, path: string, fn: (ref: string, path: string) => string): unknown {
  if (v === undefined || v === null) return v;
  const meta = s.meta() as { ui?: string } | undefined;
  const d = (s as any)._zod.def;
  if (typeof v === "string" && (meta?.ui === "asset" || d.type === "string" && meta?.ui === "asset")) return fn(v, path);
  switch (d.type) {
    case "optional": case "default": case "nullable": case "prefault": case "readonly":
      if (meta?.ui === "asset" && typeof v === "string") return fn(v, path);
      return walk(d.innerType, v, path, fn);
    case "object": {
      const o: Record<string, unknown> = { ...(v as object) };
      for (const [k, child] of Object.entries(d.shape as Record<string, z.ZodType>)) if (k in o) o[k] = walk(child, o[k], path ? `${path}.${k}` : k, fn);
      return o;
    }
    case "array":
      return (v as unknown[]).map((x, i) => walk(d.element, x, `${path}.${i}`, fn));
    case "union":
      for (const opt of d.options as z.ZodType[]) if (opt.safeParse(v).success) return walk(opt, v, path, fn);
      return v;
  }
  return v;
}

/** All asset refs in a scene's props. */
export function listAssets(type: string, props: unknown): { ref: string; path: string }[] {
  const out: { ref: string; path: string }[] = [];
  mapAssets(type, props, (ref, path) => (out.push({ ref, path }), ref));
  return out;
}
