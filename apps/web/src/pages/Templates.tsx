import { useEffect, useState } from "react";
import { SCENE_ICON, SCENE_NAME, api, navigate, type BrandKit, type Template } from "../api.ts";
import { BrandPicker, FormatPicker, Spinner } from "../components/ui.tsx";

export function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pick, setPick] = useState<Template | null>(null);
  const [cat, setCat] = useState("All");
  useEffect(() => { api.templates().then(setTemplates); }, []);
  const cats = ["All", ...new Set(templates.map((t) => t.category).filter(Boolean))];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Templates</h1><p>Pick a starting point. Everything is editable: text, images, scenes, music and voice.</p></div></div>
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
  const [brands, setBrands] = useState<BrandKit[]>([]);
  const [brand, setBrand] = useState("luraplus");
  const [title, setTitle] = useState("");
  const [formats, setFormats] = useState<string[]>(t.formats);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { api.brandkits().then((b) => { setBrands(b); if (b.length && !b.some((x) => x.id === brand)) setBrand(b[0].id); }); }, []); // eslint-disable-line
  const create = async () => {
    setBusy(true); setErr("");
    try { const { id } = await api.create({ title: title || t.name, template: t.id, brand, formats }); navigate(`#/p/${id}`); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="scrim" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><h2 style={{ flex: 1 }}>{t.name}</h2><button className="btn ghost sm" onClick={onClose}>Close</button></div>
        <div className="drawer-body">
          {t.thumbnail && <img src={t.thumbnail} alt="" style={{ width: "100%", borderRadius: 12, background: "#0E1222", aspectRatio: "16/9", objectFit: "contain" }} />}
          <p className="muted" style={{ margin: 0 }}>{t.description}</p>
          <label className="f"><span className="l">Video name</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.name} autoFocus /></label>
          <div className="f"><span className="l">Brand</span><BrandPicker brands={brands} value={brand} onChange={setBrand} /></div>
          <div className="f"><span className="l">Formats</span><FormatPicker value={formats} onChange={setFormats} /><p className="help">Each format is rendered separately and laid out for its screen.</p></div>
          {err && <div className="banner bad">{err}</div>}
        </div>
        <div className="drawer-foot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={create}>{busy ? <><Spinner /> Creating…</> : "Use this template"}</button></div>
      </div>
    </div>
  );
}
