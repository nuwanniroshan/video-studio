import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fileUrl, setIn, type Catalog, type Issue, type Job, type Json, type PreviewRes } from "./api.ts";
import { SchemaForm, type FormCtx } from "./components/SchemaForm.tsx";

const TYPE_ICON: Record<string, string> = { kineticTitle: "Aa", logoReveal: "◎", featureSpotlight: "▣", featureGrid: "▦", screenFlow: "⌖", statsCounter: "#", mediaBroll: "▨", ctaEndCard: "➔" };
const headlineOf = (s: Json) => String(s.props?.headline ?? s.props?.title ?? s.props?.tagline ?? s.props?.kicker ?? "").replace(/\*/g, "");

export function Editor({ id }: { id: string }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [spec, setSpec] = useState<Json>(null);
  const [assets, setAssets] = useState<string[]>([]);
  const [sel, setSel] = useState<number | "video">("video");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "invalid">("saved");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [variant, setVariant] = useState<string>("");
  const [pv, setPv] = useState<PreviewRes | null>(null);
  const [pvState, setPvState] = useState<"idle" | "loading" | "error">("idle");
  const [pvErr, setPvErr] = useState("");
  const [showRender, setShowRender] = useState(false);
  const saveTimer = useRef<number>(0);
  const pvSeq = useRef(0);

  useEffect(() => {
    api.catalog().then(setCat);
    api.project(id).then((p) => { setSpec(p.spec); setAssets(p.assets); setVariant(p.spec.variants?.[0]?.id ?? "main"); });
  }, [id]);

  const refreshPreview = useCallback(async (v?: string) => {
    const seq = ++pvSeq.current;
    setPvState("loading");
    try {
      const r = await api.preview(id, v ?? variant);
      if (seq === pvSeq.current) { setPv(r); setPvState("idle"); setPvErr(""); }
    } catch (e) {
      if (seq === pvSeq.current) { setPvState("error"); setPvErr((e as Error).message); }
    }
  }, [id, variant]);
  useEffect(() => { if (spec && variant) refreshPreview(variant); }, [variant]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every edit: update state now, save after a pause, then refresh the preview. */
  const update = (next: Json) => {
    setSpec(next);
    setSaveState("dirty");
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaveState("saving");
      const r = await api.save(id, next);
      setIssues(r.issues ?? []);
      setSaveState(r.ok ? "saved" : "invalid");
      if (r.ok) refreshPreview();
    }, 700);
  };

  const ctx: FormCtx = useMemo(() => ({ project: id, assets, onAssetsChanged: () => api.project(id).then((p) => setAssets(p.assets)) }), [id, assets]);
  if (!spec || !cat) return <div className="loading">Loading…</div>;

  const scenes: Json[] = spec.scenes;
  const timing = (sid: string) => pv?.scenes.find((s) => s.id === sid);
  const lintFor = (sid: string) => pv?.lint.filter((l) => l.scene === sid) ?? [];
  const addScene = (type: string) => {
    const def = cat.scenes.find((d) => d.type === type)!;
    let n = 1; while (scenes.some((s) => s.id === `${type.toLowerCase()}-${n}`)) n++;
    const s = { id: `${type.toLowerCase()}-${n}`, type, tone: "light", vo: [{ text: "Write the voice-over for this scene." }], props: structuredClone(def.example) };
    const at = typeof sel === "number" ? sel + 1 : scenes.length;
    update({ ...spec, scenes: [...scenes.slice(0, at), s, ...scenes.slice(at)] });
    setSel(at);
  };
  const move = (i: number, d: number) => {
    const a = [...scenes]; [a[i], a[i + d]] = [a[i + d], a[i]];
    update({ ...spec, scenes: a }); setSel(i + d);
  };
  const removeScene = (i: number) => {
    if (!confirm(`Remove scene "${scenes[i].id}"?`)) return;
    const sid = scenes[i].id;
    const variants = spec.variants.map((v: Json) => (v.scenes ? { ...v, scenes: v.scenes.filter((x: string) => x !== sid) } : v));
    update({ ...spec, variants, scenes: scenes.filter((_: Json, j: number) => j !== i) }); setSel("video");
  };

  return (
    <div className="page editor">
      <header className="topbar">
        <a href="#/" className="brandmark">▶ Video Studio</a>
        <input className="title" value={spec.title} onChange={(e) => update({ ...spec, title: e.target.value })} />
        <span className={`save ${saveState}`}>{{ saved: "Saved", saving: "Saving…", dirty: "Editing…", invalid: "Not saved: fix the highlighted issue" }[saveState]}</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setShowRender(true)}>Render video</button>
      </header>
      {issues.length > 0 && <div className="banner error">{issues.map((i, k) => <div key={k}><b>{i.path}</b>: {i.message}</div>)}</div>}
      <div className="cols">
        <aside className="scenes">
          <div className={`scene-card video ${sel === "video" ? "sel" : ""}`} onClick={() => setSel("video")}>
            <b>Video settings</b><span className="muted">music, voice, formats</span>
          </div>
          {scenes.map((s, i) => {
            const t = timing(s.id); const l = lintFor(s.id);
            return (
              <div key={s.id + i} className={`scene-card ${sel === i ? "sel" : ""} tone-${s.tone ?? "light"}`} onClick={() => setSel(i)}>
                <div className="sc-top"><span className="ticon">{TYPE_ICON[s.type] ?? "□"}</span><span className="sc-type">{cat.scenes.find((d) => d.type === s.type)?.meta.label}</span>
                  {t && <span className="chip">{(t.end - t.start).toFixed(1)}s</span>}
                  {l.length > 0 && <span className="chip warn" title={l.map((x) => x.message).join("\n")}>⚠ {l.length}</span>}
                </div>
                <div className="sc-head">{headlineOf(s) || s.id}</div>
                {s.vo?.[0] && <div className="sc-vo">“{s.vo.map((v: Json) => v.text).join(" ")}”</div>}
                {sel === i && <div className="sc-ctl" onClick={(e) => e.stopPropagation()}>
                  <button className="link small" disabled={i === 0} onClick={() => move(i, -1)}>↑ Up</button>
                  <button className="link small" disabled={i === scenes.length - 1} onClick={() => move(i, 1)}>↓ Down</button>
                  <button className="link small danger" disabled={scenes.length <= 1} onClick={() => removeScene(i)}>Remove</button>
                </div>}
              </div>
            );
          })}
          <AddScene cat={cat} onAdd={addScene} />
        </aside>

        <section className="center">
          <PreviewPane pv={pv} state={pvState} err={pvErr} variant={variant} setVariant={setVariant}
            seekTo={typeof sel === "number" ? timing(scenes[sel]?.id)?.start : undefined} onRefresh={() => refreshPreview()} />
        </section>

        <aside className="inspector">
          {sel === "video"
            ? <VideoSettings spec={spec} cat={cat} update={update} />
            : scenes[sel] && <SceneInspector key={scenes[sel].id + sel} scene={scenes[sel]} index={sel} spec={spec} cat={cat} ctx={ctx}
                onChange={(s) => update(setIn(spec, ["scenes", sel], s))} />}
        </aside>
      </div>
      {showRender && <RenderPanel id={id} spec={spec} cat={cat} onClose={() => setShowRender(false)} />}
    </div>
  );
}

function AddScene({ cat, onAdd }: { cat: Catalog; onAdd(type: string): void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="add-scene">
      <button className="link" onClick={() => setOpen(!open)}>+ Add scene</button>
      {open && <div className="menu">{cat.scenes.map((d) => (
        <button key={d.type} onClick={() => { onAdd(d.type); setOpen(false); }}>
          <b>{TYPE_ICON[d.type]} {d.meta.label}</b><span>{d.meta.description}</span>
        </button>
      ))}</div>}
    </div>
  );
}

function PreviewPane({ pv, state, err, variant, setVariant, seekTo, onRefresh }: {
  pv: PreviewRes | null; state: string; err: string; variant: string; setVariant(v: string): void; seekTo?: number; onRefresh(): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(0.4);
  const vs = () => (frame.current?.contentWindow as any)?.__vs;

  // reload the player whenever a new preview arrives (fresh page = exactly what the renderer sees)
  useEffect(() => {
    if (!pv || !frame.current) return;
    setReady(false);
    const f = frame.current;
    f.onload = async () => { await vs()?.load(pv.doc); setReady(true); vs()?.seek(Math.min(t, pv.duration)); };
    f.src = `/runtime/index.html?ts=${Date.now()}`;
  }, [pv]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && seekTo !== undefined) { const x = seekTo + 1.5; setT(x); vs()?.seek(x); } }, [seekTo, ready]); // eslint-disable-line
  useEffect(() => {
    const fit = () => { if (pv && box.current) setScale(Math.min(box.current.clientWidth / pv.doc.width, (box.current.clientHeight - 4) / pv.doc.height)); };
    fit(); addEventListener("resize", fit); return () => removeEventListener("resize", fit);
  }, [pv]);
  useEffect(() => {
    if (!playing || !pv) return;
    let raf = 0; const start = performance.now() - t * 1000;
    const tick = (now: number) => { const x = (now - start) / 1000; if (x >= pv.duration) { setPlaying(false); return; } setT(x); vs()?.seek(x); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line

  return (
    <div className="preview">
      <div className="pv-bar">
        <select value={variant} onChange={(e) => setVariant(e.target.value)}>{(pv?.variants ?? [variant]).map((v) => <option key={v}>{v}</option>)}</select>
        {pv && <span className="muted">{pv.doc.aspect} · {pv.duration.toFixed(1)} s</span>}
        <span className="spacer" />
        {state === "loading" && <span className="muted">Updating preview… (new voice-over takes a few seconds)</span>}
        <button className="link small" onClick={onRefresh}>Refresh</button>
      </div>
      <div className="stagebox" ref={box}>
        {pv && <div style={{ width: pv.doc.width * scale, height: pv.doc.height * scale }}>
          <iframe ref={frame} title="preview" style={{ width: pv.doc.width, height: pv.doc.height, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
        </div>}
        {!pv && state !== "error" && <div className="muted">Preparing voice-over and preview…</div>}
        {state === "error" && <div className="error">{err}</div>}
      </div>
      {pv && <div className="transport">
        <button onClick={() => setPlaying(!playing)} disabled={!ready}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
        <input type="range" min={0} max={pv.duration} step={0.01} value={t} onChange={(e) => { setPlaying(false); setT(+e.target.value); vs()?.seek(+e.target.value); }} />
        <span className="time">{t.toFixed(1)} / {pv.duration.toFixed(1)}s</span>
      </div>}
      {pv && <p className="muted small">Silent preview; voice-over and music are in the rendered video.</p>}
      {pv && pv.lint.length > 0 && <div className="lint">{pv.lint.map((l, i) => <div key={i} className={l.level}>⚠ <b>{l.scene}</b>: {l.message}</div>)}</div>}
      {pv && pv.warnings.length > 0 && <div className="lint">{pv.warnings.map((w, i) => <div key={i} className="warning">⚠ {w}</div>)}</div>}
    </div>
  );
}

function SceneInspector({ scene, onChange, cat, ctx }: { scene: Json; index: number; spec: Json; cat: Catalog; ctx: FormCtx; onChange(s: Json): void }) {
  const def = cat.scenes.find((d) => d.type === scene.type)!;
  const set = (k: string, v: Json) => onChange(v === undefined ? (({ [k]: _, ...rest }) => rest)(scene) : { ...scene, [k]: v });
  const tr = scene.transitionIn ?? def.meta.defaultTransition;
  const steps = def.schema.properties?.steps ? "steps" : def.schema.properties?.items ? "items" : null;
  const nSteps = steps ? (scene.props?.[steps]?.length ?? 0) : 0;
  return (
    <div className="insp">
      <h3>{def.meta.label}</h3>
      <p className="help">{def.meta.description}</p>
      <h4>Voice-over</h4>
      {(scene.vo ?? []).map((l: Json, i: number) => (
        <div className="vo" key={i}>
          <textarea rows={2} value={l.text} onChange={(e) => set("vo", scene.vo.map((x: Json, j: number) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <div className="vo-ctl">
            {steps && <select value={l.step ?? ""} onChange={(e) => set("vo", scene.vo.map((x: Json, j: number) => (j === i ? (e.target.value === "" ? (({ step: _, ...r }) => r)(x) : { ...x, step: +e.target.value }) : x)))}>
              <option value="">Spread over the scene</option>
              {Array.from({ length: nSteps }, (_, k) => <option key={k} value={k}>Goes with {steps === "items" ? "item" : "step"} {k + 1}</option>)}
            </select>}
            <button className="link small danger" onClick={() => set("vo", scene.vo.filter((_: Json, j: number) => j !== i))}>Remove line</button>
          </div>
        </div>
      ))}
      <button className="link" onClick={() => set("vo", [...(scene.vo ?? []), { text: "New line." }])}>+ Add voice-over line</button>
      <p className="help">The scene lasts as long as its voice-over needs. Write words as they should be spoken.</p>

      <h4>Content</h4>
      <SchemaForm schema={def.schema} value={scene.props} onChange={(p) => set("props", p)} ctx={ctx} />

      <h4>Look &amp; timing</h4>
      <div className="fields">
        <div className="field"><div className="flabel">Background</div>
          <div className="seg">{cat.tones.map((t) => <button key={t} className={(scene.tone ?? "light") === t ? "on" : ""} onClick={() => set("tone", t)}>{t}</button>)}</div></div>
        <div className="field"><div className="flabel">Transition in</div>
          <select value={tr.type} onChange={(e) => set("transitionIn", { ...tr, type: e.target.value })}>{cat.transitions.map((t) => <option key={t}>{t}</option>)}</select>
          {tr.type === "push" && <select value={tr.direction ?? "left"} onChange={(e) => set("transitionIn", { ...tr, direction: e.target.value })}>{["left", "right", "up", "down"].map((d) => <option key={d}>{d}</option>)}</select>}
        </div>
        <div className="field"><div className="flabel">Music mood</div>
          <select value={scene.musicCue ?? def.meta.defaultMusicCue} onChange={(e) => set("musicCue", e.target.value)}>{cat.musicCues.map((m) => <option key={m}>{m}</option>)}</select></div>
        <div className="field"><div className="flabel">Length</div>
          <div className="seg">
            <button className={scene.duration?.mode !== "fixed" ? "on" : ""} onClick={() => set("duration", undefined)}>Fit voice-over</button>
            <button className={scene.duration?.mode === "fixed" ? "on" : ""} onClick={() => set("duration", { mode: "fixed", seconds: 5 })}>Fixed</button>
          </div>
          {scene.duration?.mode === "fixed" && <input type="number" min={1} max={60} step={0.5} value={scene.duration.seconds} onChange={(e) => set("duration", { mode: "fixed", seconds: +e.target.value })} />}
        </div>
        <label className="field check"><input type="checkbox" checked={!!scene.optional} onChange={(e) => set("optional", e.target.checked || undefined)} /> Optional (dropped first from short versions)</label>
      </div>
    </div>
  );
}

function VideoSettings({ spec, cat, update }: { spec: Json; cat: Catalog; update(s: Json): void }) {
  const music = spec.music ?? { mode: "preset", preset: "uplifting-tech" };
  const voice = spec.voice ?? { provider: "kokoro", voice: "af_heart", speed: 0.94 };
  const setV = (i: number, v: Json) => update(setIn(spec, ["variants", i], v));
  return (
    <div className="insp">
      <h3>Video settings</h3>
      <h4>Music</h4>
      <select value={music.mode === "none" ? "none" : music.preset} onChange={(e) => update({ ...spec, music: e.target.value === "none" ? { mode: "none" } : { mode: "preset", preset: e.target.value, bpm: e.target.value === "uplifting-tech" ? 96 : undefined } })}>
        {cat.presets.map((p) => <option key={p} value={p}>{p.replace(/-/g, " ")}</option>)}<option value="none">No music</option>
      </select>
      <h4>Voice</h4>
      <select value={voice.voice} onChange={(e) => update({ ...spec, voice: { ...voice, provider: "kokoro", voice: e.target.value } })}>
        {cat.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
      </select>
      <div className="field"><div className="flabel">Speaking speed <span className="muted">{(voice.speed ?? 0.94).toFixed(2)}×</span></div>
        <input type="range" min={0.8} max={1.15} step={0.01} value={voice.speed ?? 0.94} onChange={(e) => update({ ...spec, voice: { ...voice, provider: "kokoro", speed: +e.target.value } })} /></div>
      <h4>Formats</h4>
      {spec.variants.map((v: Json, i: number) => (
        <div className="variant" key={i}>
          <div className="row"><b>{v.id}</b>
            <select value={v.aspect} onChange={(e) => setV(i, { ...v, aspect: e.target.value, safeArea: e.target.value === "9:16" ? "reels" : "title" })}>
              {cat.aspects.map((a) => <option key={a} value={a}>{{ "16:9": "16:9 landscape", "9:16": "9:16 phone / reels", "1:1": "1:1 square", "4:5": "4:5 feed" }[a]}</option>)}
            </select>
            {spec.variants.length > 1 && <button className="link small danger" onClick={() => update({ ...spec, variants: spec.variants.filter((_: Json, j: number) => j !== i) })}>Remove</button>}
          </div>
          <div className="field"><div className="flabel">Scenes in this format</div>
            <div className="chips">{spec.scenes.map((s: Json) => {
              const on = !v.scenes || v.scenes.includes(s.id);
              return <label key={s.id} className="chipcheck"><input type="checkbox" checked={on} onChange={() => {
                const cur: string[] = v.scenes ?? spec.scenes.map((x: Json) => x.id);
                const next = on ? cur.filter((x) => x !== s.id) : spec.scenes.map((x: Json) => x.id).filter((x: string) => x === s.id || cur.includes(x));
                setV(i, { ...v, scenes: next.length === spec.scenes.length ? undefined : next });
              }} /> {s.id}</label>;
            })}</div></div>
          <div className="field"><div className="flabel">Max length (seconds, optional)</div>
            <input type="number" min={5} max={600} value={v.maxDuration ?? ""} onChange={(e) => setV(i, { ...v, maxDuration: e.target.value === "" ? undefined : +e.target.value })} /></div>
        </div>
      ))}
      <button className="link" onClick={() => {
        let n = 1; while (spec.variants.some((v: Json) => v.id === `format-${n}`)) n++;
        update({ ...spec, variants: [...spec.variants, { id: `format-${n}`, aspect: "1:1", safeArea: "title" }] });
      }}>+ Add format</button>
    </div>
  );
}

function RenderPanel({ id, spec, cat, onClose }: { id: string; spec: Json; cat: Catalog; onClose(): void }) {
  const [quality, setQuality] = useState(spec.quality ?? "standard");
  const [variants, setVariants] = useState<string[]>(spec.variants.map((v: Json) => v.id));
  const [all, setAll] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [outputs, setOutputs] = useState<Awaited<ReturnType<typeof api.outputs>>>([]);
  const loadOutputs = () => api.outputs(id).then(setOutputs);
  useEffect(() => { loadOutputs(); api.renders(id).then((js) => { const live = js.find((j) => j.status === "running" || j.status === "queued"); if (live) follow(live); }); }, []); // eslint-disable-line

  const follow = (j: Job) => {
    setJob(j);
    const es = new EventSource(`/api/renders/${j.id}/events`);
    es.onmessage = (m) => { const x = JSON.parse(m.data) as Job; setJob(x); if (x.status === "done" || x.status === "error") { es.close(); loadOutputs(); } };
  };
  const start = async () => follow(await api.render(id, { variants, quality, deliverables: all ? "all" : "none" }));
  const busy = job && (job.status === "running" || job.status === "queued");
  const fmt = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);
  const QUAL: Record<string, string> = { draft: "Draft: quick preview (half size)", standard: "Standard: final video", cinema: "Cinema: 60 fps, smoothest motion (slow)" };

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row"><h3>Render video</h3><span className="spacer" /><button className="link" onClick={onClose}>Close</button></div>
        <div className="field"><div className="flabel">Quality</div>
          {cat.qualities.map((q) => <label key={q} className="radio"><input type="radio" checked={quality === q} onChange={() => setQuality(q)} /> {QUAL[q] ?? q}</label>)}</div>
        <div className="field"><div className="flabel">Formats</div>
          {spec.variants.map((v: Json) => <label key={v.id} className="radio"><input type="checkbox" checked={variants.includes(v.id)}
            onChange={(e) => setVariants(e.target.checked ? [...variants, v.id] : variants.filter((x) => x !== v.id))} /> {v.id} ({v.aspect})</label>)}</div>
        <label className="radio"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Also make web, social and landing-page versions, captions and thumbnails</label>
        <button className="primary" disabled={!!busy || !variants.length} onClick={start}>{busy ? "Rendering…" : "Start render"}</button>
        {job && <div className="progress">
          <div className="bar"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
          <div className={job.status === "error" ? "error" : "muted"}>{job.status === "error" ? job.error : job.message}</div>
        </div>}
        {outputs.length > 0 && <div className="outputs">
          <h4>Downloads</h4>
          {outputs.map((o) => (
            <div key={o.variant} className="out">
              <b>{o.variant}</b>
              {o.files.filter((f) => f.name.endsWith(".mp4")).slice(0, 1).map((f) => <video key={f.path} src={fileUrl(id, f.path)} controls preload="metadata" />)}
              <ul>{o.files.map((f) => <li key={f.path}><a href={`${fileUrl(id, f.path)}?download`}>{f.name}</a> <span className="muted">{fmt(f.bytes)}</span></li>)}</ul>
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
