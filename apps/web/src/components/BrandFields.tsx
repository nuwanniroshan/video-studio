import { useEffect, useState } from "react";
import type { Base, FontOpt } from "../api.ts";
import { FilePick, Icon, mixHex, paletteFromImage, useFontFace, fam } from "./ui.tsx";

export type Role = "display" | "body" | "mono";
export interface CustomBrand { name: string; base: Base; fonts: Record<Role, { library?: string }> }
/** Files waiting to be uploaded once the project exists: logo, logoOnLight, fontDisplay, fontBody. */
export type PendingFiles = Partial<Record<"logo" | "logoOnLight" | "fontDisplay" | "fontBody", File>>;

export const DEFAULT_BASE: Base = { primary: "#4F46E5", accent: "#0EA5E9", dark: "#0B1020", light: "#F6F7FB", ink: "#0F1222" };
const COLOR_HELP: Record<keyof Base, string> = { primary: "Buttons, accents", accent: "Highlights", dark: "Dark scenes", light: "Light scenes", ink: "Text" };

/** The user's own brand: logo (colours picked from it), five colours, fonts from the library or uploaded. */
export function BrandFields({ value, onChange, files, setFiles, fonts }: {
  value: CustomBrand; onChange(b: CustomBrand): void; files: PendingFiles; setFiles(f: PendingFiles): void; fonts: FontOpt[];
}) {
  const [logoUrl, setLogoUrl] = useState<string>();
  const [lightUrl, setLightUrl] = useState<string>();
  const [twoLogos, setTwoLogos] = useState(false);
  const [picked, setPicked] = useState(false);
  useEffect(() => { const u = files.logo && URL.createObjectURL(files.logo); setLogoUrl(u); return () => { if (u) URL.revokeObjectURL(u); }; }, [files.logo]);
  useEffect(() => { const u = files.logoOnLight && URL.createObjectURL(files.logoOnLight); setLightUrl(u); return () => { if (u) URL.revokeObjectURL(u); }; }, [files.logoOnLight]);
  const fromLogo = async (url?: string) => { if (!url) return; const p = await paletteFromImage(url); if (p) { onChange({ ...value, base: p }); setPicked(true); } };
  const setLogo = async (f: File) => { setFiles({ ...files, logo: f }); await fromLogo(URL.createObjectURL(f)); };

  const fontSel = (role: "display" | "body", label: string) => {
    const key = role === "display" ? "fontDisplay" : "fontBody";
    const cur = value.fonts[role]?.library;
    const lib = fonts.find((f) => f.id === cur);
    return (
      <div className="f"><span className="l">{label}</span>
        <div className="row">
          <select value={files[key] ? "__upload" : cur ?? ""} onChange={(e) => { if (e.target.value === "__upload") return; const { [key]: _, ...rest } = files; setFiles(rest); onChange({ ...value, fonts: { ...value.fonts, [role]: { library: e.target.value } } }); }}>
            {files[key] && <option value="__upload">{files[key]!.name} (your file)</option>}
            {fonts.filter((f) => f.roles.includes(role)).map((f) => <option key={f.id} value={f.id}>{f.family} · {f.style}</option>)}
          </select>
          <FilePick accept=".ttf,.otf,.woff,.woff2" onFile={(f) => setFiles({ ...files, [key]: f })}><button type="button" className="btn sm" title="Upload your own font">{Icon.upload}</button></FilePick>
        </div>
        {!files[key] && lib && <FontSample url={lib.url} role={role} />}
      </div>
    );
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="two">
        <div className="f"><span className="l">Logo</span>
          <FilePick accept="image/png,image/svg+xml,image/webp,image/jpeg" onFile={setLogo}>
            <div className="logo-drop" style={{ background: value.base.dark }}>
              {logoUrl ? <img src={logoUrl} alt="" /> : <span style={{ color: "#fff", display: "grid", justifyItems: "center", gap: 4 }}>{Icon.upload}<b>Upload logo</b></span>}
              <span className="hint" style={{ color: "#fff" }}>PNG or SVG, transparent background</span></div>
          </FilePick>
          {!twoLogos ? <button type="button" className="link sm" style={{ alignSelf: "flex-start" }} onClick={() => setTwoLogos(true)}>+ Different logo for light backgrounds</button> : (
            <FilePick accept="image/png,image/svg+xml,image/webp,image/jpeg" onFile={(f) => setFiles({ ...files, logoOnLight: f })}>
              <div className="logo-drop" style={{ background: value.base.light, height: 70 }}>{lightUrl ? <img src={lightUrl} alt="" /> : <b style={{ color: value.base.ink }}>Logo for light backgrounds</b>}</div>
            </FilePick>)}
        </div>
        <div className="col" style={{ gap: 10 }}>
          <label className="f"><span className="l">Brand name *</span><input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="e.g. Acme" /></label>
          <p className="help">{logoUrl ? (picked ? "Colours were picked from your logo; adjust them below." : "") : "No logo? Your brand name is used as a clean wordmark."}</p>
          {logoUrl && <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => fromLogo(logoUrl)}>{Icon.palette} Pick colours from logo</button>}
        </div>
      </div>
      <div className="f"><span className="l">Colours</span>
        <div className="colors">{(Object.keys(DEFAULT_BASE) as (keyof Base)[]).map((k) => (
          <div className="color-in" key={k}>
            <div className="cin"><input type="color" value={value.base[k]} onChange={(e) => onChange({ ...value, base: { ...value.base, [k]: e.target.value.toUpperCase() } })} />
              <input type="text" value={value.base[k]} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && onChange({ ...value, base: { ...value.base, [k]: e.target.value.toUpperCase() } })} /></div>
            <span className="tiny muted"><b style={{ textTransform: "capitalize", color: "var(--ink-2)" }}>{k}</b> · {COLOR_HELP[k]}</span></div>))}
        </div>
        <div className="palette">{[0.9, 0.6, 0.18].map((t) => <i key={t} style={{ background: mixHex(value.base.primary, "#FFFFFF", t) }} />)}
          {[value.base.primary, mixHex(value.base.primary, "#000000", 0.28), value.base.accent, value.base.dark, value.base.ink, value.base.light].map((c, i) => <i key={i} style={{ background: c }} />)}</div>
      </div>
      <div className="two">{fontSel("display", "Headline font")}{fontSel("body", "Body font")}</div>
    </div>
  );
}

function FontSample({ url, role }: { url: string; role: Role }) {
  const n = useFontFace(url);
  return <div className="fontsample" style={{ fontFamily: fam(n), fontWeight: role === "display" ? 600 : 400, fontSize: role === "display" ? 20 : 14 }}>
    {role === "display" ? "Work, made simple." : "Everything your team needs, in one place."}</div>;
}
