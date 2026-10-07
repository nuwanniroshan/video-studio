/** Brand kit → CSS custom properties + @font-face. Schema validation lands with packages/spec in M1. */
export interface FontSpec { family: string; file: string; weight?: string }
export interface BrandKit {
  id: string;
  name: string;
  colors: Record<string, string>;
  fonts: { display: FontSpec; body: FontSpec; mono: FontSpec };
  logo: { onDark: string; onLight: string; mark?: string };
  voice?: { provider: string; voice: string; speed: number };
  pronunciations?: Record<string, { ipa?: string; respell?: string }>;
  music?: { preset: string };
  cta?: { url: string };
}

/** primary400 → primary400, onDark → on-dark (digits stay attached so tokens read like the theme). */
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** `base` is the URL prefix the brand directory is served from, e.g. `/brand/luraplus/`. */
export function brandCss(kit: BrandKit, base: string): string {
  const out: string[] = [];
  for (const [role, f] of Object.entries(kit.fonts)) {
    out.push(`@font-face{font-family:"vs-${role}";src:url("${base}${f.file}") format("truetype");font-weight:${f.weight ?? "100 900"};font-display:block}`);
  }
  const vars = Object.entries(kit.colors).map(([k, v]) => `--vs-${kebab(k)}:${v};`);
  vars.push(
    `--vs-font-display:"vs-display",system-ui,sans-serif;`,
    `--vs-font-body:"vs-body",system-ui,sans-serif;`,
    `--vs-font-mono:"vs-mono",ui-monospace,monospace;`,
    `--vs-logo-on-dark:url("${base}${kit.logo.onDark}");`,
    `--vs-logo-on-light:url("${base}${kit.logo.onLight}");`,
    `--vs-shadow-md:0 6px 16px rgba(14,17,22,.08);`,
    `--vs-shadow-lg:0 12px 32px rgba(14,17,22,.12);`,
    `--vs-shadow-xl:0 30px 80px rgba(14,17,22,.18),0 8px 24px rgba(14,17,22,.08);`,
  );
  out.push(`:root{${vars.join("")}}`);
  return out.join("\n");
}
