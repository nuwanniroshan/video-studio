import { useEffect, useState } from "react";
import { api, fileUrl, type Json } from "../api.ts";

type Out = Awaited<ReturnType<typeof api.outputs>>[number];
const KIND = (n: string) => (/\.(mp4|webm)$/.test(n) ? "video" : /\.(srt|vtt)$/.test(n) ? "captions" : /\.jpg$/.test(n) ? "image" : /\.wav$/.test(n) ? "audio" : "other");
const LABEL = (n: string) => {
  const m = n.match(/_(master|web|hero_muted|landing)\.(mp4|webm)$/);
  if (m) return { master: "Master (highest quality)", web: "Web and social", hero_muted: "Website hero (muted loop)", landing: "Landing page (with sound)" }[m[1]]! + ` · ${m[2].toUpperCase()}`;
  if (/\.mp4$/.test(n)) return "Review copy";
  if (/_poster\.jpg$/.test(n)) return "Poster"; if (/_thumb_/.test(n)) return "Thumbnail · " + n.replace(/.*_thumb_\d+_/, "").replace(".jpg", "");
  if (/\.srt$/.test(n)) return "Captions (SRT)"; if (/\.vtt$/.test(n)) return "Captions (WebVTT)";
  if (/_stem_(\w+)\.wav$/.test(n)) return "Audio stem · " + n.match(/_stem_(\w+)\.wav$/)![1]; if (/_mix\.wav$/.test(n)) return "Final audio mix";
  return n;
};
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);

export function Watch({ id }: { id: string }) {
  const [outs, setOuts] = useState<Out[] | null>(null);
  const [title, setTitle] = useState("");
  const [v, setV] = useState(0);
  useEffect(() => { api.outputs(id).then(setOuts); api.project(id).then((p) => setTitle(p.spec.title)); }, [id]);
  if (!outs) return <div className="page muted">Loading…</div>;
  if (!outs.length) return <div className="page"><div className="empty">Nothing rendered yet. <a href={`#/p/${id}`}>Open the editor</a> and press Render.</div></div>;
  const o = outs[Math.min(v, outs.length - 1)];
  const main = o.files.find((f) => /_master\.mp4$/.test(f.name)) ?? o.files.find((f) => /_web\.mp4$/.test(f.name)) ?? o.files.find((f) => f.name.endsWith(".mp4"));
  const vtt = o.files.find((f) => f.name.endsWith(".vtt"));
  const poster = o.files.find((f) => /_poster\.jpg$/.test(f.name));
  const groups: [string, string][] = [["video", "Videos"], ["image", "Images"], ["captions", "Captions"], ["audio", "Audio"]];
  return (
    <div className="page">
      <div className="page-head">
        <div><a href="#/" className="muted small">← Videos</a><h1>{title}</h1></div><span className="spacer" />
        <a className="btn" href={`#/p/${id}`}>Edit video</a>
        {main && <a className="btn primary" href={`${fileUrl(id, main.path)}?download`}>Download {main.name.includes("master") ? "master" : "video"}</a>}
      </div>
      {outs.length > 1 && <div className="seg" style={{ marginBottom: 14 }}>{outs.map((x, i) => <button key={x.variant} className={i === v ? "on" : ""} onClick={() => setV(i)}>{x.variant}</button>)}</div>}
      <div className="watch">
        <div className="col" style={{ gap: 14 }}>
          <div className="player">{main && <video key={main.path} src={fileUrl(id, main.path)} poster={poster ? fileUrl(id, poster.path) : undefined} controls playsInline>
            {vtt && <track kind="captions" src={fileUrl(id, vtt.path)} srcLang="en" label="English" />}</video>}</div>
          <div className="thumbs">{o.files.filter((f) => KIND(f.name) === "image").slice(0, 6).map((f) => <img key={f.path} src={fileUrl(id, f.path)} alt={LABEL(f.name)} title={LABEL(f.name)} />)}</div>
        </div>
        <aside className="card files">
          {groups.map(([k, label]) => {
            const fs = o.files.filter((f) => KIND(f.name) === k);
            if (!fs.length) return null;
            return (
              <div key={k} className="col" style={{ gap: 6 }}>
                <h4>{label}</h4>
                {fs.map((f: Json) => (
                  <a key={f.path} className="file" href={`${fileUrl(id, f.path)}?download`}>
                    <span className="ext">{f.name.split(".").pop()}</span>
                    <span className="nm" title={f.name}>{LABEL(f.name)}</span><span className="sz">{size(f.bytes)}</span>
                  </a>
                ))}
              </div>
            );
          })}
          <p className="help">Re-render from the editor after changes; only the scenes you changed are rendered again.</p>
        </aside>
      </div>
    </div>
  );
}
