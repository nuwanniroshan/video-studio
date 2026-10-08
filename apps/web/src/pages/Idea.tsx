import { useEffect, useRef, useState } from "react";
import { SCENE_ICON, SCENE_NAME, api, navigate, type BrandKit, type Brief, type Json } from "../api.ts";
import { BrandPicker, FilePick, FormatPicker, Spinner } from "../components/ui.tsx";

const GOALS = [
  { id: "launch", emoji: "🚀", name: "Feature launch", desc: "Announce something new" },
  { id: "promo", emoji: "✨", name: "Product promo", desc: "Problem → solution story" },
  { id: "announcement", emoji: "📣", name: "Announcement", desc: "Short news update" },
  { id: "explainer", emoji: "🧭", name: "How-to", desc: "Step-by-step guide" },
  { id: "social", emoji: "📱", name: "Social teaser", desc: "15 s vertical hook" },
];
const PLACEHOLDER: Record<string, { message: string; problem: string; points: string[] }> = {
  launch: { message: "Payroll, done in minutes", problem: "Payroll day eats your whole week", points: ["Automatic tax tables", "One-click approvals", "Payslips sent instantly"] },
  promo: { message: "Run your whole business from one place", problem: "Your team juggles five tools for one job", points: ["One record per person", "Secure by default", "Loved by teams"] },
  announcement: { message: "We're opening in Sydney", problem: "", points: ["Local support", "Faster onboarding", "Events near you"] },
  explainer: { message: "Run your first pay run", problem: "", points: ["Open Payroll and start a pay run", "Check the totals", "Approve and pay"] },
  social: { message: "Payroll in minutes", problem: "Still doing payroll by hand?", points: ["82% faster", "Zero errors"] },
};

export function Idea() {
  const [b, setB] = useState<Brief>({ goal: "launch", product: "", message: "", problem: "", audience: "", points: [{ title: "" }, { title: "" }, { title: "" }],
    cta: "Book a demo", ctaLine: "", url: "", mood: "energetic", length: 45, formats: ["16:9"], brand: "luraplus", voice: "af_heart" });
  const [stat, setStat] = useState({ on: false, value: "", prefix: "", suffix: "%", label: "" });
  const [shots, setShots] = useState<{ ref: string; url: string }[]>([]);
  const [brands, setBrands] = useState<BrandKit[]>([]);
  const [voices, setVoices] = useState<{ id: string; label: string }[]>([]);
  const [outline, setOutline] = useState<Json | null>(null);
  const [outlineErr, setOutlineErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(false);
  const timer = useRef(0);
  const set = (p: Partial<Brief>) => setB((x) => ({ ...x, ...p }));
  useEffect(() => { api.brandkits().then(setBrands); api.catalog().then((c) => setVoices(c.voices)); }, []);

  const full = (): Brief => ({
    ...b, points: b.points.filter((p) => p.title.trim()), screenshots: shots.map((s) => s.ref),
    ...(stat.on && stat.value !== "" && stat.label ? { stat: { value: +stat.value, prefix: stat.prefix || undefined, suffix: stat.suffix || undefined, label: stat.label } } : { stat: undefined }),
  });
  // live outline of the storyboard the rules will write
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const ph = PLACEHOLDER[b.goal];
      const draft = full();
      const preview = { ...draft, product: draft.product || "Your product", message: draft.message || ph.message, cta: draft.cta || "Learn more",
        points: draft.points.length ? draft.points : ph.points.map((t) => ({ title: t })) };
      try { setOutline(await api.briefPreview(preview)); setOutlineErr(""); } catch (e) { setOutlineErr((e as Error).message); }
    }, 350);
  }, [b, stat, shots]); // eslint-disable-line

  const ph = PLACEHOLDER[b.goal];
  const generate = async () => {
    setErr(""); setBusy(true);
    try { const { id } = await api.fromBrief(full()); navigate(`#/p/${id}`); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const testVoice = async () => {
    setPlaying(true);
    try { const url = await api.voiceTest({ text: b.message || ph.message, voice: b.voice, brand: b.brand }); const a = new Audio(url); a.onended = () => setPlaying(false); await a.play(); }
    catch { setPlaying(false); }
  };
  const words = (outline?.scenes ?? []).reduce((n: number, s: Json) => n + s.vo.reduce((m: number, v: Json) => m + v.text.split(/\s+/).length, 0), 0);

  return (
    <div className="page">
      <div className="page-head"><div><h1>Describe your idea</h1><p>Answer a few questions. We write the storyboard, voice-over and music, and you can fine-tune everything after. <a href="#/templates">Or start from a template →</a></p></div></div>
      <div className="idea">
        <div className="col" style={{ gap: 16 }}>
          <div className="card section">
            <div className="section-title"><span className="n">1</span><h3>What are you making?</h3></div>
            <div className="goals">{GOALS.map((g) => (
              <button key={g.id} type="button" className={`toggle-card ${b.goal === g.id ? "on" : ""}`}
                onClick={() => set({ goal: g.id, ...(g.id === "social" ? { length: 15, formats: ["9:16"] } : g.id === "announcement" ? { length: 30 } : b.length === 15 ? { length: 45, formats: ["16:9"] } : {}), ...(g.id === "explainer" ? { mood: "calm" } : {}) })}>
                <span className="emoji">{g.emoji}</span><b>{g.name}</b><span>{g.desc}</span>
              </button>))}
            </div>
          </div>

          <div className="card section">
            <div className="section-title"><span className="n">2</span><h3>The message</h3></div>
            <div className="two">
              <label className="f"><span className="l">Product or company name *</span><input value={b.product} onChange={(e) => set({ product: e.target.value })} placeholder="e.g. LuraPlus" /></label>
              <label className="f"><span className="l">Who is it for?</span><input value={b.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="e.g. HR managers" /></label>
            </div>
            <label className="f"><span className="l">The one thing viewers should remember *</span><input value={b.message} onChange={(e) => set({ message: e.target.value })} placeholder={ph.message} />
              <span className="help">Short and concrete. It becomes the main headline.</span></label>
            {b.goal !== "explainer" && b.goal !== "announcement" &&
              <label className="f"><span className="l">The problem it solves</span><input value={b.problem} onChange={(e) => set({ problem: e.target.value })} placeholder={ph.problem} />
                <span className="help">Optional. Opens the video on a dark "sound familiar?" hook.</span></label>}
          </div>

          <div className="card section">
            <div className="section-title"><span className="n">3</span><h3>{b.goal === "explainer" ? "The steps" : "Key points"}</h3><span className="muted small">{b.goal === "explainer" ? "in order" : "features or benefits, up to 6"}</span></div>
            {b.points.map((p, i) => (
              <div className="point" key={i}>
                <span className="num">{i + 1}</span>
                <input value={p.title} placeholder={ph.points[i] ?? (b.goal === "explainer" ? "Next step" : "Another point")} onChange={(e) => set({ points: b.points.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <input value={p.detail ?? ""} placeholder="One line of detail (optional)" onChange={(e) => set({ points: b.points.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })} />
                <button className="btn ghost sm" title="Remove" disabled={b.points.length <= 1} onClick={() => set({ points: b.points.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            {b.points.length < 6 && <button className="link sm" style={{ alignSelf: "flex-start" }} onClick={() => set({ points: [...b.points, { title: "" }] })}>+ Add {b.goal === "explainer" ? "step" : "point"}</button>}
            <div className="f"><span className="l">Product screenshots</span>
              <div className="shots">
                {shots.map((s, i) => <div className="shot" key={s.ref}><img src={s.url} alt="" /><button onClick={() => setShots(shots.filter((_, j) => j !== i))}>✕</button></div>)}
                {shots.length < 5 && <FilePick className="shot add" accept="image/png,image/jpeg,image/webp" onFile={async (f) => { const r = await api.upload(f); setShots((x) => [...x, { ref: r.ref, url: URL.createObjectURL(f) }]); }}>+ Add</FilePick>}
              </div>
              <span className="help">Optional. Real screenshots make the strongest videos. {b.goal === "explainer" ? "One per step, in order: the cursor clicks through them." : "The first one is shown in a browser frame."}</span>
            </div>
          </div>

          <div className="card section">
            <div className="section-title"><span className="n">4</span><h3>Proof and call to action</h3></div>
            <label className="field check"><input type="checkbox" checked={stat.on} onChange={(e) => setStat({ ...stat, on: e.target.checked })} /> Show a number that proves it</label>
            {stat.on && <div className="point" style={{ gridTemplateColumns: "70px 110px 70px 1fr" }}>
              <input value={stat.prefix} placeholder="$" onChange={(e) => setStat({ ...stat, prefix: e.target.value })} />
              <input value={stat.value} type="number" placeholder="82" onChange={(e) => setStat({ ...stat, value: e.target.value })} />
              <input value={stat.suffix} placeholder="%" onChange={(e) => setStat({ ...stat, suffix: e.target.value })} />
              <input value={stat.label} placeholder="less time per pay run" onChange={(e) => setStat({ ...stat, label: e.target.value })} />
            </div>}
            <div className="three">
              <label className="f"><span className="l">Button text *</span><input value={b.cta} onChange={(e) => set({ cta: e.target.value })} placeholder="Book a demo" /></label>
              <label className="f"><span className="l">Closing line</span><input value={b.ctaLine} onChange={(e) => set({ ctaLine: e.target.value })} placeholder="Run payroll from one platform" /></label>
              <label className="f"><span className="l">Website</span><input value={b.url} onChange={(e) => set({ url: e.target.value })} placeholder="luraplus.io" /></label>
            </div>
          </div>

          <div className="card section">
            <div className="section-title"><span className="n">5</span><h3>Look and sound</h3></div>
            <div className="f"><span className="l">Brand</span><BrandPicker brands={brands} value={b.brand!} onChange={(id) => set({ brand: id })} /></div>
            <div className="two">
              <div className="f"><span className="l">Length</span><div className="seg">{[15, 30, 45, 60].map((n) => <button key={n} className={b.length === n ? "on" : ""} onClick={() => set({ length: n })}>{n} s</button>)}</div></div>
              <div className="f"><span className="l">Music</span><div className="seg">
                <button className={b.mood !== "calm" ? "on" : ""} onClick={() => set({ mood: "energetic" })}>Uplifting</button>
                <button className={b.mood === "calm" ? "on" : ""} onClick={() => set({ mood: "calm" })}>Calm</button></div></div>
            </div>
            <div className="f"><span className="l">Voice</span><div className="row">
              <select value={b.voice} onChange={(e) => set({ voice: e.target.value })}>{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
              <button className="btn" onClick={testVoice} disabled={playing}>{playing ? <><Spinner /> Playing</> : "▶ Listen"}</button></div></div>
            <div className="f"><span className="l">Formats</span><FormatPicker value={b.formats!} onChange={(f) => set({ formats: f })} /></div>
          </div>
          {err && <div className="banner bad">{err}</div>}
        </div>

        <aside className="card outline">
          <div className="row"><h3 style={{ flex: 1 }}>Storyboard</h3><span className="chip accent">≈ {Math.max(b.length ?? 30, Math.round(words / 2.3 + (outline?.scenes?.length ?? 0) * 1.2))} s</span></div>
          <p className="muted small" style={{ margin: 0 }}>What we'll create. You can edit every scene afterwards.</p>
          {outlineErr && <div className="banner bad">{outlineErr}</div>}
          {(outline?.scenes ?? []).map((s: Json, i: number) => (
            <div className="oscene" key={i}>
              <span className={`ic ${s.tone ?? "light"}`}>{SCENE_ICON[s.type]}</span>
              <div>
                <b>{i + 1}. {SCENE_NAME[s.type]}</b>
                {(s.props.headline || s.props.tagline || s.props.title) && <div className="h">{String(s.props.headline ?? s.props.tagline ?? s.props.title).replace(/\*/g, "")}</div>}
                <span>“{s.vo.map((v: Json) => v.text).join(" ")}”</span>
              </div>
            </div>
          ))}
          <button className="btn primary lg" disabled={busy || !b.product.trim() || !b.message.trim() || !b.cta.trim()} onClick={generate}>
            {busy ? <><Spinner /> Writing the storyboard…</> : "Create video"}</button>
          {(!b.product.trim() || !b.message.trim()) && <span className="help" style={{ textAlign: "center" }}>Add the product name and message to continue.</span>}
        </aside>
      </div>
    </div>
  );
}
