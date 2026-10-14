import { z } from "zod";
import { Aspect, MusicCue, SAFE_AREAS, Tone, TransitionSpec, type SafeAreaName } from "./common.ts";
import { AssetRef } from "./fields.ts";
import { SCENE_DEFS, catalog } from "./scenes/index.ts";

export const SPEC_VERSION = 1;

const Id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "lowercase letters, digits and dashes; starts with a letter");

export const VoLine = z.object({
  id: Id.optional().meta({ help: "Defaults to v1, v2… within the scene." }),
  text: z.string().min(1).max(320).meta({ ui: "text", label: "Voice-over line" }),
  /** Explicit IPA for the whole line; overrides the brand dictionary. Rarely needed. */
  phonemes: z.string().optional(),
  /** Uploaded human VO for this line (overrides TTS). */
  asset: AssetRef.optional(),
  /** Binds the line to a step of a multi-step scene (featureGrid item, screenFlow step). */
  step: z.number().int().min(0).optional(),
});
export type VoLine = z.infer<typeof VoLine>;

export const Duration = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto"), min: z.number().min(0).max(60).optional() }),
  z.object({ mode: z.literal("fixed"), seconds: z.number().gt(0).max(120) }),
]);

const sceneBase = {
  id: Id,
  tone: Tone.default("light").meta({ ui: "select", label: "Tone" }),
  transitionIn: TransitionSpec.optional(),
  musicCue: MusicCue.optional().meta({ ui: "select", label: "Music cue" }),
  duration: Duration.default({ mode: "auto" }),
  vo: z.array(VoLine).max(12).default([]),
  /** Dropped first when a variant has to fit `maxDuration`. */
  optional: z.boolean().default(false),
  aspectOverrides: z.partialRecord(Aspect, z.object({ props: z.record(z.string(), z.unknown()) })).optional(),
};

export const Scene = z.discriminatedUnion("type",
  SCENE_DEFS.map((d) => z.object({ ...sceneBase, type: z.literal(d.type), props: d.schema })) as unknown as
    [z.ZodObject, ...z.ZodObject[]]);
const SceneShape = z.object({ ...sceneBase, type: z.string(), props: z.record(z.string(), z.unknown()) });
/** Typed view of a parsed scene (props are validated by the scene's own schema in the union above). */
export type Scene = z.output<typeof SceneShape>;

export const Music = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preset"), preset: z.string().default("uplifting-tech"), bpm: z.number().min(50).max(180).optional(), key: z.string().optional() }),
  z.object({ mode: z.literal("upload"), asset: AssetRef, bpm: z.number().min(50).max(200).optional(), downbeatOffset: z.number().optional() }),
  z.object({ mode: z.literal("none") }),
]);

export const Voice = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("kokoro"), voice: z.string().default("af_heart"), speed: z.number().min(0.6).max(1.4).default(0.94) }),
  z.object({ provider: z.literal("upload") }),
]);

export const Variant = z.object({
  id: Id,
  aspect: Aspect,
  scenes: z.array(Id).min(1).optional(),
  maxDuration: z.number().gt(0).optional(),
  captions: z.enum(["none", "burned", "sidecar"]).default("sidecar"),
  safeArea: z.enum(Object.keys(SAFE_AREAS) as [SafeAreaName, ...SafeAreaName[]]).default("title"),
  loudness: z.number().min(-30).max(-9).optional().meta({ help: "Integrated LUFS target; default −16 (web), use −14 for social." }),
  overrides: z.record(Id, z.object({
    vo: z.array(VoLine).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    duration: Duration.optional(),
  })).optional(),
});
export type Variant = z.infer<typeof Variant>;

export const Spec = z.object({
  $schema: z.string().optional(),
  version: z.literal(SPEC_VERSION),
  title: z.string().min(1).max(120),
  brand: z.string().regex(/^[a-z0-9-]+$/),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).default(60),
  quality: z.enum(["draft", "standard", "cinema"]).default("standard"),
  music: Music.default({ mode: "preset", preset: "uplifting-tech" }),
  voice: Voice.default({ provider: "kokoro", voice: "af_heart", speed: 0.94 }),
  timing: z.object({
    snap: z.enum(["bar", "beat", "none"]).default("bar"),
    leadIn: z.number().min(0).max(3).default(0.45),
    lineGap: z.number().min(0).max(3).default(0.35),
    tail: z.number().min(0).max(5).default(0.6),
  }).default({ snap: "bar", leadIn: 0.45, lineGap: 0.35, tail: 0.6 }),
  variants: z.array(Variant).min(1).default([{ id: "main", aspect: "16:9", captions: "sidecar", safeArea: "title" }]),
  scenes: z.array(Scene).min(1),
});
export type SpecInput = z.input<typeof Spec>;
export type Spec = Omit<z.output<typeof Spec>, "scenes"> & { scenes: Scene[] };

export interface Issue { path: string; message: string }

/** Parse + semantic checks. Never throws; returns issues with JSON paths. */
export function validateSpec(raw: unknown): { ok: true; spec: Spec; issues: [] } | { ok: false; issues: Issue[] } {
  const r = Spec.safeParse(raw);
  if (!r.success) return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  const spec = r.data as Spec;
  const issues: Issue[] = [];
  const ids = new Set<string>();
  spec.scenes.forEach((s, i) => {
    if (ids.has(s.id)) issues.push({ path: `scenes.${i}.id`, message: `duplicate scene id "${s.id}"` });
    ids.add(s.id);
    const vo = new Set<string>();
    s.vo.forEach((v, j) => {
      const id = v.id ?? `v${j + 1}`;
      if (vo.has(id)) issues.push({ path: `scenes.${i}.vo.${j}.id`, message: `duplicate vo id "${id}"` });
      vo.add(id);
    });
    for (const [aspect, o] of Object.entries(s.aspectOverrides ?? {})) {
      const merged = catalog[s.type].schema.safeParse({ ...(s.props as object), ...o!.props });
      if (!merged.success) issues.push({ path: `scenes.${i}.aspectOverrides.${aspect}`, message: merged.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
    }
  });
  const vids = new Set<string>();
  spec.variants.forEach((v, i) => {
    if (vids.has(v.id)) issues.push({ path: `variants.${i}.id`, message: `duplicate variant id "${v.id}"` });
    vids.add(v.id);
    v.scenes?.forEach((s, j) => { if (!ids.has(s)) issues.push({ path: `variants.${i}.scenes.${j}`, message: `unknown scene "${s}"` }); });
    for (const [sid, o] of Object.entries(v.overrides ?? {})) {
      const sc = spec.scenes.find((s) => s.id === sid);
      if (!sc) { issues.push({ path: `variants.${i}.overrides.${sid}`, message: `unknown scene "${sid}"` }); continue; }
      if (o.props) {
        const merged = catalog[sc.type].schema.safeParse({ ...(sc.props as object), ...o.props });
        if (!merged.success) issues.push({ path: `variants.${i}.overrides.${sid}.props`, message: merged.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      }
    }
  });
  if (spec.music.mode === "upload") issues.push({ path: "music", message: "uploaded music arrives in M3; use a preset or none" });
  if (spec.voice.provider === "upload" && spec.scenes.some((s) => s.vo.some((v) => !v.asset)))
    issues.push({ path: "voice", message: "voice.provider=upload needs an asset on every VO line" });
  return issues.length ? { ok: false, issues } : { ok: true, spec, issues: [] };
}

export interface EffectiveScene {
  id: string; type: string; version: number; tone: z.infer<typeof Tone>; musicCue: z.infer<typeof MusicCue>;
  transitionIn: z.infer<typeof TransitionSpec>; duration: z.infer<typeof Duration>; optional: boolean;
  vo: (VoLine & { id: string })[]; props: Record<string, unknown>;
}

/** Scenes for one variant: order/inclusion, variant overrides, aspect overrides, defaults applied, ids filled. */
export function effectiveScenes(spec: Spec, variantId: string): EffectiveScene[] {
  const v = spec.variants.find((x) => x.id === variantId);
  if (!v) throw new Error(`unknown variant "${variantId}"`);
  const order = v.scenes ?? spec.scenes.map((s) => s.id);
  return order.map((sid, i) => {
    const s = spec.scenes.find((x) => x.id === sid)!;
    const def = catalog[s.type];
    const o = v.overrides?.[sid];
    const props = def.schema.parse({ ...(s.props as object), ...(s.aspectOverrides?.[v.aspect]?.props ?? {}), ...(o?.props ?? {}) }) as Record<string, unknown>;
    const vo = (o?.vo ?? s.vo).map((l, j) => ({ ...l, id: l.id ?? `v${j + 1}` }));
    return {
      id: s.id, type: s.type, version: def.version, tone: s.tone, optional: s.optional,
      musicCue: s.musicCue ?? def.meta.defaultMusicCue,
      transitionIn: i === 0 ? { type: "cut" } : s.transitionIn ?? def.meta.defaultTransition,
      duration: o?.duration ?? s.duration, vo, props,
    };
  });
}
