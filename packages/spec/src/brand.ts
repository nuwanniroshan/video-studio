import { z } from "zod";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Font = z.object({ family: z.string(), file: z.string(), weight: z.string().optional(), licence: z.boolean().optional() });

/** Brand kit (brands/<id>/brand.json). Colours become --vs-* CSS variables. */
export const BrandKit = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  colors: z.object({ primary: Hex, primary400: Hex, primary700: Hex, primary50: Hex, accent: Hex, ink: Hex, dark: Hex, light: Hex })
    .catchall(Hex),
  fonts: z.object({ display: Font, body: Font, mono: Font }),
  logo: z.object({ onDark: z.string(), onLight: z.string(), mark: z.string().optional() }),
  voice: z.object({ provider: z.literal("kokoro"), voice: z.string(), speed: z.number() }).optional(),
  pronunciations: z.record(z.string(), z.union([z.object({ ipa: z.string() }), z.object({ respell: z.string() })])).default({}),
  music: z.object({ preset: z.string() }).optional(),
  cta: z.object({ url: z.string() }).optional(),
});
export type BrandKit = z.infer<typeof BrandKit>;
