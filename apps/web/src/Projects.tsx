import { useEffect, useState } from "react";
import { api } from "./api.ts";

export function Projects() {
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof api.projects>>>([]);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof api.templates>>>([]);
  const [brands, setBrands] = useState<Awaited<ReturnType<typeof api.brands>>>([]);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("feature-launch");
  const [brand, setBrand] = useState("luraplus");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () => api.projects().then(setProjects);
  useEffect(() => { load(); api.templates().then(setTemplates); api.brands().then(setBrands); }, []);

  const create = async () => {
    setBusy(true); setErr("");
    try { const { id } = await api.create({ title: title || "Untitled video", template, brand }); location.hash = `#/p/${id}`; }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div className="page">
      <header className="topbar"><div className="brandmark">▶ Video Studio</div></header>
      <main className="projects">
        <section className="card new">
          <h2>New video</h2>
          <label>Name<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Payroll launch" autoFocus /></label>
          <label>Start from
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.id.replace(/-/g, " ")} · {t.scenes} scenes</option>)}
            </select>
          </label>
          <p className="hint">{templates.find((t) => t.id === template)?.description}</p>
          <label>Brand
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
          <button className="primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create video"}</button>
          {err && <p className="error">{err}</p>}
        </section>
        <section className="list">
          <h2>Your videos</h2>
          {!projects.length && <p className="hint">No videos yet. Create one on the left.</p>}
          <div className="grid">
            {projects.map((p) => (
              <a key={p.id} className="card project" href={`#/p/${p.id}`}>
                <div className="thumb">{p.thumbnail ? <img src={p.thumbnail} alt="" /> : <span>{p.scenes} scenes</span>}</div>
                <div className="pt">{p.title}</div>
                <div className="pm">{p.brand} · {new Date(p.updated).toLocaleString()} {p.renders.length ? `· rendered: ${p.renders.join(", ")}` : ""}</div>
                <button className="link danger" onClick={async (e) => { e.preventDefault(); if (confirm(`Delete "${p.title}"? This cannot be undone.`)) { await api.remove(p.id); load(); } }}>Delete</button>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
