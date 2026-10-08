import { useEffect, useMemo, useState } from "react";
import { api, type Base, type BrandKit, type FontOpt, type Json, type Theme } from "../api.ts";
import { FilePick, Icon, Spinner, ThemeGrid, fam, mixHex, onHex, paletteFromImage, useFontFace } from "../components/ui.tsx";

const COLOR_HELP: Record<keyof Base, string> = { primary: "Buttons, accents", accent: "Highlights", dark: "Dark scenes", light: "Light scenes", ink: "Text" };
type Role = "display" | "body" | "mono";
interface Draft { name: string; base: Base; fonts: Record<Role, { library?: string; family?: string; file?: string }>; pron: { term: string; kind: "respell" | "ipa"; value: string }[]; ctaUrl: string }

/** This video's own brand: start from a theme or set logo, colours, fonts and pronunciations. */
export function ProjectBrand({ id }: { id: string }) {
  const [fonts, setFonts] = useState<FontOpt[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [spec, setSpec] = useState<Json>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [showThemes, setShowThemes] = useState(false);

  const load = (k: BrandKit) => {
    setKit(k);
    setD({ name: k.name, base: (k.base ?? { primary: k.colors.primary, accent: k.colors.accent, dark: k.colors.dark, light: k.colors.light, ink: k.colors.ink }) as Base,
      fonts: Object.fromEntries((["display", "body", "mono"] as Role[]).map((r) => [r, { family: k.fonts[r]?.family, file: k.fonts[r]?.file }])) as Draft["fonts"],
      pron: Object.entries(k.pronunciations ?? {}).map(([term, v]) => ({ term, kind: v.ipa ? "ipa" : "respell", value: (v.ipa ?? v.respell)! })), ctaUrl: k.cta?.url ?? "" });
  };
  useEffect(() => { api.fonts().then(setFonts); api.themes().then(setThemes); api.brand(id).then(load); api.project(id).then((p) => setSpec(p.spec)); }, [id]);
  // show library fonts as library choices
  const libOf = (r: Role) => d && (d.fonts[r].library ?? fonts.find((f) => d.fonts[r].file === `fonts/${f.file}`)?.id);
  const faceUrl = (r: Role) => { const l = libOf(r); return l ? fonts.find((f) => f.id === l)?.url : kit?.urls.fonts[r]; };
  const fd = useFontFace(faceUrl("display")), fb = useFontFace(faceUrl("body")), fm = useFontFace(faceUrl("mono"));
  const palette = useMemo(() => d ? [mixHex(d.base.primary, "#FFFFFF", 0.9), mixHex(d.base.primary, "#FFFFFF", 0.6), mixHex(d.base.primary, "#FFFFFF", 0.18), d.base.primary,
    mixHex(d.base.primary, "#000000", 0.12), mixHex(d.base.primary, "#000000", 0.28), d.base.accent, d.base.dark, d.base.ink, d.base.light] : [], [d]);
  if (!d || !kit) return <div className="page muted">Loading…</div>;

  const run = async (label: string, fn: () => Promise<BrandKit>, ok: string) => {
    setBusy(label); setMsg(null);
    try { load(await fn()); setMsg({ kind: "ok", text: ok }); }
    catch (e) { setMsg({ kind: "bad", text: (e as Error).message + ((e as any).issues ? `: ${(e as any).issues.map((i: any) => i.message).join(", ")}` : "") }); }
    setBusy("");
  };
  const save = () => run("save", () => api.saveBrand(id, {
    name: d.name, base: d.base, ctaUrl: d.ctaUrl,
    fonts: Object.fromEntries((["display", "body", "mono"] as Role[]).map((r) => [r, libOf(r) ? { library: libOf(r) } : { family: d.fonts[r].family, file: d.fonts[r].file }])),
    pronunciations: Object.fromEntries(d.pron.filter((p) => p.term.trim() && p.value.trim()).map((p) => [p.term.trim(), p.kind === "ipa" ? { ipa: p.value.trim() } : { respell: p.value.trim() }])),
  }), "Saved. The preview and next render use the new brand.");
  const upload = (kind: string, f: File) => run(kind, () => api.brandFile(id, kind, f), kind.startsWith("font") ? "Font uploaded." : "Logo uploaded.");
  const pickTheme = (t: string) => { if (confirm("Switch to this theme? Colours and fonts change; your name, logo, website and pronunciations stay.")) run("theme", () => api.applyTheme(id, t), "Theme applied."); };
  const listen = async (key: string, text: string, pron?: Draft["pron"]) => {
    setPlaying(key);
    try {
      const pr = Object.fromEntries((pron ?? d.pron).filter((p) => p.term && p.value).map((p) => [p.term, p.kind === "ipa" ? { ipa: p.value } : { respell: p.value }]));
      const a = new Audio(await api.voiceTest({ text, voice: spec?.voice?.voice, speed: spec?.voice?.speed, pronunciations: pr }));
      a.onended = () => setPlaying(null); await a.play();
    } catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); setPlaying(null); }
  };
  const theme = themes.find((t) => t.id === kit.theme);
  const fontSel = (role: Role, label: string, sample: string, face: string) => (
    <div className="fontrow">
      <span className="l small" style={{ fontWeight: 600 }}>{label}</span>
      <div className="col" style={{ gap: 6 }}>
        <div className="row">
          <select value={libOf(role) ?? "__current"} onChange={(e) => e.target.value !== "__current" && setD({ ...d, fonts: { ...d.fonts, [role]: { library: e.target.value } } })}>
            {!libOf(role) && <option value="__current">{d.fonts[role].family} (uploaded)</option>}
            {fonts.filter((f) => f.roles.includes(role)).map((f) => <option key={f.id} value={f.id}>{f.family} · {f.style}</option>)}
          </select>
          <FilePick accept=".ttf,.otf,.woff,.woff2" onFile={(f) => upload(`font${role[0].toUpperCase()}${role.slice(1)}`, f)}><button className="btn sm" type="button">{busy.startsWith("font") ? <Spinner /> : Icon.upload} Upload</button></FilePick>
        </div>
        <div className="fontsample" style={{ fontFamily: fam(face), fontWeight: role === "display" ? 600 : 400, fontSize: role === "display" ? 22 : 15 }}>{sample}</div>
      </div>
    </div>
  );
  const logoBox = (which: "logoOnDark" | "logoOnLight") => {
    const dark = which === "logoOnDark";
    const word = dark ? kit.wordmark?.onDark : kit.wordmark?.onLight;
    return (
      <div className="f"><span className="l">Logo on {dark ? "dark" : "light"} backgrounds {word && <span className="chip">name wordmark</span>}</span>
        <FilePick accept="image/png,image/svg+xml,image/webp,image/jpeg" onFile={(f) => upload(which, f)}>
          <div className="logo-drop" style={{ background: dark ? d.base.dark : d.base.light }}>
            {kit.urls[which] && <img src={kit.urls[which]} alt="" />}<span className="hint" style={{ color: dark ? "#fff" : d.base.ink }}>{busy === which ? "Uploading…" : "Click to upload PNG or SVG"}</span></div>
        </FilePick></div>
    );
  };

  return (
    <div className="page">
      <div className="page-head"><div><a href={`#/p/${id}`} className="muted small">← Back to the editor</a><h1>Brand · {spec?.title ?? ""}</h1>
        <p>This brand belongs to this video only. {theme ? <>Started from the <b>{theme.name}</b> theme.</> : null}</p></div><span className="spacer" />
        <button className="btn" onClick={() => setShowThemes(!showThemes)}>{Icon.palette} {showThemes ? "Hide themes" : "Switch theme"}</button>
        <button className="btn primary" disabled={!!busy || !d.name.trim()} onClick={save}>{busy === "save" ? <><Spinner /> Saving…</> : "Save brand"}</button></div>
      {msg && <div className={`banner ${msg.kind === "ok" ? "info" : "bad"}`} style={{ marginBottom: 16 }}>{msg.text}</div>}
      {showThemes && <div className="card section" style={{ marginBottom: 16 }}><h3>Themes</h3><ThemeGrid themes={themes} value={kit.theme ?? ""} onChange={pickTheme} name={d.name} /></div>}
      <div className="bedit">
        <div className="col" style={{ gap: 16 }}>
          <div className="card section">
            <h3>Identity</h3>
            <div className="two">
              <label className="f"><span className="l">Brand name *</span><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
              <label className="f"><span className="l">Website (end card)</span><input value={d.ctaUrl} onChange={(e) => setD({ ...d, ctaUrl: e.target.value })} placeholder="acme.com" /></label>
            </div>
            <div className="two">{logoBox("logoOnDark")}{logoBox("logoOnLight")}</div>
            <div className="row">
              {!kit.wordmark?.onDark && kit.urls.logoOnDark && <button className="btn sm" onClick={async () => { const p = await paletteFromImage(kit.urls.logoOnDark!); if (p) setD({ ...d, base: p }); }}>{Icon.palette} Pick colours from logo</button>}
              {(!kit.wordmark?.onDark || !kit.wordmark?.onLight) && <button className="btn sm ghost danger" onClick={() => run("logo", () => api.removeLogo(id), "Logo removed; the name wordmark is used.")}>Remove logo</button>}
            </div>
          </div>
          <div className="card section">
            <h3>Colours</h3>
            <div className="colors">{(Object.keys(COLOR_HELP) as (keyof Base)[]).map((k) => (
              <div className="color-in" key={k}>
                <div className="cin"><input type="color" value={d.base[k]} onChange={(e) => setD({ ...d, base: { ...d.base, [k]: e.target.value.toUpperCase() } })} />
                  <input type="text" value={d.base[k]} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && setD({ ...d, base: { ...d.base, [k]: e.target.value.toUpperCase() } })} /></div>
                <span className="tiny muted"><b style={{ textTransform: "capitalize", color: "var(--ink-2)" }}>{k}</b> · {COLOR_HELP[k]}</span></div>))}
            </div>
            <div className="palette">{palette.map((c, i) => <i key={i} style={{ background: c }} />)}</div>
            <span className="help">Tints, shades and greys are generated from these five colours.</span>
          </div>
          <div className="card section">
            <h3>Typography</h3>
            {fontSel("display", "Headlines", `${d.name || "Your brand"}, made simple.`, fd)}
            {fontSel("body", "Body", "Everything your team needs, in one place.", fb)}
            {fontSel("mono", "Labels", "NEW · 01 / KICKER", fm)}
            <span className="help">Only upload fonts you're licensed to use in video.</span>
          </div>
          <div className="card section">
            <div className="row"><h3 style={{ flex: 1 }}>Pronunciation</h3><button className="link sm" onClick={() => setD({ ...d, pron: [...d.pron, { term: "", kind: "respell", value: "" }] })}>+ Add word</button></div>
            <p className="help">Teach the narrator brand names. "Sounds like" uses plain spelling (SaaS → sass); IPA is exact (Lura → lˈuːɹə). Captions keep your spelling.</p>
            {d.pron.map((p, i) => (
              <div className="dict" key={i}>
                <input value={p.term} placeholder="Word" onChange={(e) => setD({ ...d, pron: d.pron.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)) })} />
                <select value={p.kind} onChange={(e) => setD({ ...d, pron: d.pron.map((x, j) => (j === i ? { ...x, kind: e.target.value as "ipa" | "respell" } : x)) })}><option value="respell">Sounds like</option><option value="ipa">IPA</option></select>
                <input value={p.value} placeholder={p.kind === "ipa" ? "lˈuːɹə" : "loo-rah"} onChange={(e) => setD({ ...d, pron: d.pron.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                <button className="btn sm" title="Listen" disabled={!p.term || !!playing} onClick={() => listen(`p${i}`, `Say hello to ${p.term}.`, [p])}>{playing === `p${i}` ? <Spinner /> : "▶"}</button>
                <button className="btn ghost sm" onClick={() => setD({ ...d, pron: d.pron.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <div className="row"><button className="btn sm" disabled={!!playing} onClick={() => listen("all", `Welcome to ${d.name}. Here's what's new.`)}>{playing === "all" ? <Spinner /> : "▶"} Hear the brand name</button></div>
          </div>
        </div>
        <div className="bprev">
          <span className="l small" style={{ fontWeight: 700, color: "var(--faint)", letterSpacing: ".07em", textTransform: "uppercase" }}>Preview</span>
          <div className="bp-card" style={{ background: `radial-gradient(120% 80% at 75% 35%, ${d.base.primary}26, transparent 60%), ${d.base.dark}`, color: "#fff" }}>
            <div className="grid" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)" }} />
            {kit.urls.logoOnDark && <img className="lg" src={kit.urls.logoOnDark} alt="" />}
            <div className="k" style={{ fontFamily: fam(fm, "monospace"), color: palette[2] }}><i />Introducing</div>
            <div className="h" style={{ fontFamily: fam(fd) }}>{d.name || "Your brand"}, <span style={{ opacity: .4 }}>made simple.</span></div>
            <div className="s" style={{ fontFamily: fam(fb) }}>Everything your team needs, in one place.</div>
          </div>
          <div className="bp-card" style={{ background: d.base.light, color: d.base.ink }}>
            <div className="grid" style={{ backgroundImage: `linear-gradient(${d.base.ink}0A 1px, transparent 1px), linear-gradient(90deg, ${d.base.ink}0A 1px, transparent 1px)` }} />
            {kit.urls.logoOnLight && <img className="lg" src={kit.urls.logoOnLight} alt="" />}
            <div className="k" style={{ fontFamily: fam(fm, "monospace"), color: d.base.primary }}><i />New feature</div>
            <div className="h" style={{ fontFamily: fam(fd) }}>Work, <span style={{ color: d.base.primary }}>done in minutes.</span></div>
            <div className="s" style={{ fontFamily: fam(fb) }}>Hours, leave and allowances flow straight in.</div>
            <span className="btnp" style={{ background: d.base.primary, color: onHex(d.base.primary), fontFamily: fam(fd) }}>Get started →</span>
          </div>
        </div>
      </div>
    </div>
  );
}
