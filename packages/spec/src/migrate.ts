/*
 * Spec migrations. Every saved revision records `version`; `migrate()` runs on load and walks
 * the chain up to SPEC_VERSION. v0 is the pre-release shape (VO as plain strings, music as a
 * preset name) and exists so the chain is exercised from day one.
 */
import { SPEC_VERSION } from "./spec.ts";

type Raw = Record<string, any>;
const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  0: (s) => ({
    ...s,
    version: 1,
    music: typeof s.music === "string" ? { mode: "preset", preset: s.music } : s.music,
    scenes: (s.scenes ?? []).map((sc: Raw) => ({
      ...sc,
      vo: (sc.vo ?? []).map((v: unknown, i: number) => (typeof v === "string" ? { id: `v${i + 1}`, text: v } : v)),
    })),
  }),
};

export function migrate(raw: unknown): Raw {
  let s = { ...(raw as Raw) };
  let v = typeof s.version === "number" ? s.version : 0;
  if (v > SPEC_VERSION) throw new Error(`spec version ${v} is newer than this tool (${SPEC_VERSION})`);
  while (v < SPEC_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`no migration from spec version ${v}`);
    s = m(s);
    v = s.version;
  }
  return s;
}
