import { useEffect, useState } from "react";
import { api, fileUrl, timeAgo, type Json } from "../api.ts";
import { Icon } from "../components/ui.tsx";

type P = Awaited<ReturnType<typeof api.projects>>[number];

export function Home() {
  const [projects, setProjects] = useState<P[] | null>(null);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const load = () => api.projects().then(async (ps) => {
    setProjects(ps);
    // poster: a rendered poster/thumbnail if there is one, else the contact sheet
    const entries = await Promise.all(ps.map(async (p) => {
      if (!p.renders.length) return [p.id, p.thumbnail ?? ""] as const;
      const outs = await api.outputs(p.id).catch(() => [] as Json[]);
      const f = outs.flatMap((o: Json) => o.files).find((x: Json) => /_(poster|thumb_\d+_[a-z0-9-]+)\.jpg$/.test(x.name));
      return [p.id, f ? fileUrl(p.id, f.path) : p.thumbnail ?? ""] as const;
    }));
    setPosters(Object.fromEntries(entries));
  });
  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Videos</h1><p>Make motion-graphics videos with voice-over, music and sound design.</p></div>
      </div>
      <div className="starts">
        <a className="start t" href="#/templates"><div className="deco" /><div className="arrow">→</div>
          <h2>Start from a template</h2><p>Launches, promos, announcements, how-tos and social teasers, ready to make your own.</p></a>
        <a className="start i" href="#/idea"><div className="deco" /><div className="arrow">→</div>
          <h2>Describe your idea</h2><p>Tell us the product, the message and the key points. We write the storyboard, voice-over and music.</p></a>
      </div>
      <div className="row" style={{ marginBottom: 14 }}><h2>Recent</h2><span className="muted small">{projects?.length ?? 0} videos</span></div>
      {projects && !projects.length && <div className="empty">No videos yet. Start from a template or describe your idea above.</div>}
      <div className="grid-cards">
        {projects?.map((p) => (
          <a key={p.id} href={`#/p/${p.id}`} className="card vcard">
            <div className={`poster ${posters[p.id]?.includes("-sheet.jpg") ? "sheet" : ""}`} style={{ backgroundImage: posters[p.id] ? `url(${posters[p.id]})` : undefined }}>
              {!posters[p.id] && <span className="small">{p.scenes} scenes</span>}
              <span className="badge">{p.renders.length ? <span className="chip ok">● Rendered</span> : <span className="chip">Draft</span>}</span>
            </div>
            <div className="body">
              <div className="t">{p.title}</div>
              <div className="m"><span className="chip accent">{p.brand}</span><span className="muted small">{p.scenes} scenes · edited {timeAgo(p.updated)}</span></div>
              <div className="acts">
                <span className="btn sm">Edit</span>
                {p.renders.length > 0 && <span className="btn sm" onClick={(e) => { e.preventDefault(); location.hash = `#/p/${p.id}/watch`; }}>{Icon.play} Watch</span>}
                <span className="spacer" />
                <span className="btn sm ghost danger" onClick={async (e) => { e.preventDefault(); if (confirm(`Delete "${p.title}"? This cannot be undone.`)) { await api.remove(p.id); load(); } }}>Delete</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
