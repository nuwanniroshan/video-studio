import { useEffect, useState } from "react";
import { SCENE_ICON, SCENE_NAME, api, navigate, type Template, type Theme } from "../api.ts";
import { FormatPicker, Icon, Spinner, ThemeGrid } from "../components/ui.tsx";

export function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pick, setPick] = useState<Template | null>(null);
  const [cat, setCat] = useState("All");
  useEffect(() => { api.templates().then(setTemplates); }, []);
  const cats = ["All", ...new Set(templates.map((t) => t.category).filter(Boolean))];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Templates</h1><p>Proven storyboards to start from. Use one as it is, or let the AI agent rewrite it for your idea. <a href="#/new">Or start from a blank idea →</a></p></div></div>
      <div className="seg" style={{ marginBottom: 18 }}>{cats.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}</div>
      <div className="grid-cards">
        {templates.filter((t) => cat === "All" || t.category === cat).map((t) => (
          <button key={t.id} className="card tcard" onClick={() => setPick(t)}>
            <div className={`thumb ${t.formats[0] === "9:16" ? "portrait" : ""}`} style={{ backgroundImage: t.thumbnail ? `url(${t.thumbnail})` : undefined }} />
            <div className="body">
              <div className="row"><h3 style={{ flex: 1 }}>{t.name}</h3><span className="chip">{t.length}</span></div>
              <p className="muted small" style={{ margin: 0 }}>{t.description}</p>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <div className="scenes">{t.scenes.map((s, i) => <span key={i} className="sicon" title={SCENE_NAME[s]}>{SCENE_ICON[s]}</span>)}</div>
                <div className="row" style={{ gap: 4 }}>{t.formats.map((f) => <span key={f} className="chip">{f}</span>)}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
      {pick && <UseTemplate t={pick} onClose={() => setPick(null)} />}
    </div>
  );
}

function UseTemplate({ t, onClose }: { t: Template; onClose(): void }) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [theme, setTheme] = useState(t.theme ?? "classic");
  const [name, setName] = useState("");
  const [formats, setFormats] = useState<string[]>(t.formats);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { api.themes().then(setThemes); }, []);
  const create = async () => {
    setBusy(true); setErr("");
    try { const { id } = await api.newVideo({ title: name ? `${name}: ${t.name}` : t.name, name: name || undefined, template: t.id, brand: { theme, name: name || undefined }, formats }); navigate(`#/p/${id}`); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="scrim" onClick={onClose}>
      <div className="drawer wide" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><h2 style={{ flex: 1 }}>{t.name}</h2><button className="btn ghost sm" onClick={onClose}>Close</button></div>
        <div className="drawer-body">
          {t.thumbnail && <img src={t.thumbnail} alt="" style={{ width: "100%", borderRadius: 12, background: "#0E1222", aspectRatio: "16/9", objectFit: "contain" }} />}
          <p className="muted" style={{ margin: 0 }}>{t.description}</p>
          <a className="aicta" href={`#/new?template=${t.id}`}>{Icon.wand}<div><b>Adapt it to my idea</b><span>Describe your product; the AI agent rewrites every scene and you choose branding, voice and sizes.</span></div><span>→</span></a>
          <div className="divider"><span>or use it as it is</span></div>
          <label className="f"><span className="l">Product or company name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Replaces the sample name in the text" /></label>
          <div className="f"><span className="l">Theme</span><ThemeGrid themes={themes} value={theme} onChange={setTheme} name={name || "Your brand"} /></div>
          <div className="f"><span className="l">Video sizes</span><FormatPicker value={formats} onChange={setFormats} /></div>
          {err && <div className="banner bad">{err}</div>}
        </div>
        <div className="drawer-foot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={create}>{busy ? <><Spinner /> Creating…</> : "Use this template"}</button></div>
      </div>
    </div>
  );
}
