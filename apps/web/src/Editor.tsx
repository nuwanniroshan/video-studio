import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCENE_ICON, api, navigate, setIn, type AgentJob, type AgentStatus, type BrandKit, type Catalog, type Issue, type Job, type Json, type PreviewRes } from "./api.ts";
import { AgentLog, plain, useAgentJob } from "./components/AgentLog.tsx";
import { SchemaForm, type FormCtx } from "./components/SchemaForm.tsx";
import { Icon, Spinner, Swatches } from "./components/ui.tsx";

const headlineOf = (s: Json) => String(s.props?.headline ?? s.props?.title ?? s.props?.tagline ?? s.props?.kicker ?? "").replace(/\*/g, "");

export function Editor({ id }: { id: string }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [brand, setBrand] = useState<BrandKit | null>(null);
  const [agentSt, setAgentSt] = useState<AgentStatus | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [agentJob, setAgentJob] = useState<string | null>(null);
  const [spec, setSpec] = useState<Json>(null);
  const [assets, setAssets] = useState<string[]>([]);
  const [sel, setSel] = useState<number | "video">("video");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "invalid">("saved");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [variant, setVariant] = useState("");
  const [pv, setPv] = useState<PreviewRes | null>(null);
  const [pvState, setPvState] = useState<"idle" | "loading" | "error">("idle");
  const [pvErr, setPvErr] = useState("");
  const [showRender, setShowRender] = useState(false);
  const [hasRenders, setHasRenders] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const saveTimer = useRef(0);
  const pvSeq = useRef(0);

  useEffect(() => {
    api.catalog().then(setCat);
    api.brand(id).then(setBrand).catch(() => {});
    api.agentStatus().then(setAgentSt).catch(() => {});
    api.agentJobs(id).then((js) => { const live = js.find((j) => j.status === "running"); if (live) { setAgentJob(live.id); setAskOpen(true); } });
    api.outputs(id).then((o) => setHasRenders(o.length > 0));
    api.project(id).then((p) => { setSpec(p.spec); setAssets(p.assets); setVariant(p.spec.variants?.[0]?.id ?? "main"); });
  }, [id]);

  const refreshPreview = useCallback(async (v?: string) => {
    const seq = ++pvSeq.current;
    setPvState("loading");
    try { const r = await api.preview(id, v ?? variant); if (seq === pvSeq.current) { setPv(r); setPvState("idle"); setPvErr(""); } }
    catch (e) { if (seq === pvSeq.current) { setPvState("error"); setPvErr((e as Error).message); } }
  }, [id, variant]);
  useEffect(() => { if (spec && variant) refreshPreview(variant); }, [variant]); // eslint-disable-line

  const update = (next: Json) => {
    setSpec(next); setSaveState("dirty");
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaveState("saving");
      const r = await api.save(id, next);
      setIssues(r.issues ?? []);
      setSaveState(r.ok ? "saved" : "invalid");
      if (r.ok) refreshPreview();
    }, 700);
  };

  const reload = () => api.project(id).then((p) => { setSpec(p.spec); setAssets(p.assets); setIssues([]); setSaveState("saved"); refreshPreview(); });
  const agent = useAgentJob(agentJob, () => reload());
  const agentBusy = agent?.status === "running";

  const ctx: FormCtx = useMemo(() => ({ project: id, assets, onAssetsChanged: () => api.project(id).then((p) => setAssets(p.assets)) }), [id, assets]);
  if (!spec || !cat) return <div className="page muted">Loading…</div>;

  const scenes: Json[] = spec.scenes;
  const timing = (sid: string) => pv?.scenes.find((s) => s.id === sid);
  const lintFor = (sid: string) => pv?.lint.filter((l) => l.scene === sid) ?? [];
  const addScene = (type: string) => {
    const def = cat.scenes.find((d) => d.type === type)!;
    let n = 1; while (scenes.some((s) => s.id === `${type.toLowerCase()}-${n}`)) n++;
    const s = { id: `${type.toLowerCase()}-${n}`, type, tone: type === "ctaEndCard" || type === "logoReveal" ? "dark" : "light",
      vo: [{ text: "Write what the narrator says in this scene." }], props: structuredClone(def.example) };
    const at = typeof sel === "number" ? sel + 1 : scenes.length;
    update({ ...spec, scenes: [...scenes.slice(0, at), s, ...scenes.slice(at)] }); setSel(at); setAddOpen(false);
  };
  const move = (i: number, d: number) => { const a = [...scenes]; [a[i], a[i + d]] = [a[i + d], a[i]]; update({ ...spec, scenes: a }); setSel(i + d); };
  const removeScene = (i: number) => {
    if (!confirm(`Remove scene ${i + 1}?`)) return;
    const sid = scenes[i].id;
    update({ ...spec, variants: spec.variants.map((v: Json) => (v.scenes ? { ...v, scenes: v.scenes.filter((x: string) => x !== sid) } : v)), scenes: scenes.filter((_: Json, j: number) => j !== i) });
    setSel("video");
  };
  const duplicate = (i: number) => {
    const s = structuredClone(scenes[i]); let n = 2; while (scenes.some((x) => x.id === `${scenes[i].id}-${n}`)) n++; s.id = `${scenes[i].id}-${n}`.slice(0, 40);
    update({ ...spec, scenes: [...scenes.slice(0, i + 1), s, ...scenes.slice(i + 1)] }); setSel(i + 1);
  };

  return (
    <div className="editor">
      <header className="ebar">
        <a href="#/" className="back">{Icon.back} Videos</a>
        <input className="title" value={spec.title} onChange={(e) => update({ ...spec, title: e.target.value })} />
        <span className={`save ${saveState}`}><span className="dot" />{{ saved: "All changes saved", saving: "Saving…", dirty: "Editing…", invalid: "Not saved: see the issue above the preview" }[saveState]}</span>
        <span className="spacer" />
        {agentSt?.available && <button className={`btn ${agentBusy ? "" : "ai"}`} onClick={() => setAskOpen(true)}>{agentBusy ? <Spinner /> : Icon.wand} {agentBusy ? "Agent working…" : "Ask AI"}</button>}
        <a className="btn" href={`#/p/${id}/brand`}>{Icon.palette} Brand</a>
        {hasRenders && <a className="btn" href={`#/p/${id}/watch`}>{Icon.film} Watch</a>}
        <button className="btn primary" disabled={agentBusy} onClick={() => setShowRender(true)}>Render video</button>
      </header>
      <div className={`cols ${agentBusy ? "locked" : ""}`}>
        <aside className="rail">
          <div className={`scard ${sel === "video" ? "sel" : ""}`} onClick={() => setSel("video")}>
            <div className="top"><span className="tone brand" /><span className="ty">VIDEO SETTINGS</span></div>
            <div className="hd">Brand, music, voice and formats</div>
          </div>
          <div className="rail-h"><span>Scenes · {scenes.length}</span>{pv && <span>{pv.duration.toFixed(1)} s</span>}</div>
          {scenes.map((s, i) => {
            const t = timing(s.id); const l = lintFor(s.id);
            const def = cat.scenes.find((d) => d.type === s.type);
            return (
              <div key={s.id + i} className={`scard ${sel === i ? "sel" : ""}`} onClick={() => setSel(i)} style={{ marginLeft: 8 }}>
                <span className="idx">{i + 1}</span>
                <div className="top"><span className={`tone ${s.tone ?? "light"}`} /><span className="ty">{SCENE_ICON[s.type]}  {def?.meta.label}</span>
                  {t && <span className="chip">{(t.end - t.start).toFixed(1)}s</span>}
                  {l.length > 0 && <span className="chip warn" title={l.map((x) => x.message).join("\n")}>⚠ {l.length}</span>}</div>
                <div className="hd">{headlineOf(s) || s.id}</div>
                {s.vo?.[0] && <div className="vo">“{s.vo.map((v: Json) => v.text).join(" ")}”</div>}
                {sel === i && <div className="ctl" onClick={(e) => e.stopPropagation()}>
                  <button className="link sm" disabled={i === 0} onClick={() => move(i, -1)}>↑ Up</button>
                  <button className="link sm" disabled={i === scenes.length - 1} onClick={() => move(i, 1)}>↓ Down</button>
                  <button className="link sm" onClick={() => duplicate(i)}>Duplicate</button>
                  <button className="link sm danger" disabled={scenes.length <= 1} onClick={() => removeScene(i)}>Delete</button></div>}
              </div>
            );
          })}
          {!addOpen ? <button className="btn" onClick={() => setAddOpen(true)} style={{ marginLeft: 8 }}>{Icon.plus} Add scene</button> : (
            <div className="addmenu" style={{ marginLeft: 8 }}>
              <div className="row" style={{ padding: "0 4px" }}><b className="small" style={{ flex: 1 }}>Add a scene</b><button className="link sm" onClick={() => setAddOpen(false)}>Cancel</button></div>
              {cat.scenes.map((d) => <button key={d.type} onClick={() => addScene(d.type)}><span className="sicon">{SCENE_ICON[d.type]}</span><div><b>{d.meta.label}</b><span>{d.meta.description}</span></div></button>)}
            </div>)}
        </aside>

        <section className="stagecol">
          {issues.length > 0 && <div className="banner bad">{issues.map((i, k) => <div key={k}><b>{i.path}</b>: {i.message}</div>)}</div>}
          <Preview id={id} pv={pv} state={pvState} err={pvErr} variant={variant} setVariant={setVariant} onRefresh={() => refreshPreview()}
            selScene={typeof sel === "number" ? scenes[sel]?.id : undefined} onPickScene={(sid) => setSel(scenes.findIndex((s) => s.id === sid))} />
        </section>

        <aside className="insp">
          {sel === "video"
            ? <VideoSettings id={id} spec={spec} cat={cat} brand={brand} update={update} />
            : scenes[sel] && <SceneInspector key={scenes[sel].id + sel} scene={scenes[sel]} index={sel} cat={cat} ctx={ctx} onChange={(s) => update(setIn(spec, ["scenes", sel], s))} />}
        </aside>
      </div>
      {agentBusy && <div className="lockmsg">{Icon.wand} The agent is editing this video. The preview updates when it finishes.</div>}
      {askOpen && <AskAgent id={id} job={agent} onStarted={(j) => setAgentJob(j)} onClose={() => setAskOpen(false)} />}
      {showRender && <RenderDialog id={id} spec={spec} onClose={() => setShowRender(false)} onDone={() => setHasRenders(true)} />}
    </div>
  );
}

function Preview({ id, pv, state, err, variant, setVariant, onRefresh, selScene, onPickScene }: {
  id: string; pv: PreviewRes | null; state: string; err: string; variant: string; setVariant(v: string): void; onRefresh(): void; selScene?: string; onPickScene(id: string): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [t, setT] = useState(-1); // -1: not positioned yet → open on the first settled frame
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(0.4);
  const [sound, setSound] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioState, setAudioState] = useState<"none" | "loading" | "ready" | "error">("none");
  const vs = () => (frame.current?.contentWindow as any)?.__vs;
  const seek = (x: number) => { setT(x); vs()?.seek(x); if (audio.current && Math.abs(audio.current.currentTime - x) > 0.08) audio.current.currentTime = x; };

  useEffect(() => {
    if (!pv || !frame.current) return;
    setReady(false); setAudioUrl(null); setAudioState("none");
    const f = frame.current;
    f.onload = async () => {
      await vs()?.load(pv.doc); setReady(true);
      const first = pv.scenes[0];
      const x = t >= 0 ? Math.min(t, pv.duration) : first ? Math.min(first.end - 0.2, (first.vo[0]?.t ?? 0.4) + 1.6) : 0;
      setT(x); vs()?.seek(x);
    };
    f.src = `/runtime/index.html?ts=${Date.now()}`;
  }, [pv]); // eslint-disable-line
  useEffect(() => { if (sound && pv && audioState === "none") { setAudioState("loading"); api.previewAudio(id, variant).then((r) => { setAudioUrl(r.url); setAudioState("ready"); }).catch(() => setAudioState("error")); } }, [sound, pv, audioState]); // eslint-disable-line
  useEffect(() => { const s = selScene && pv?.scenes.find((x) => x.id === selScene); if (s && ready && !playing) seek(Math.min(s.end - 0.1, s.start + 1.6)); }, [selScene, ready]); // eslint-disable-line
  useEffect(() => {
    const fit = () => { if (pv && box.current) setScale(Math.min((box.current.clientWidth - 24) / pv.doc.width, (box.current.clientHeight - 24) / pv.doc.height)); };
    fit(); const ro = new ResizeObserver(fit); if (box.current) ro.observe(box.current); return () => ro.disconnect();
  }, [pv]);
  useEffect(() => {
    if (!playing || !pv) { audio.current?.pause(); return; }
    const t0 = Math.max(0, t >= pv.duration - 0.05 ? 0 : t);
    if (sound && audio.current && audioState === "ready") { audio.current.currentTime = t0; audio.current.play().catch(() => {}); }
    let raf = 0; const start = performance.now() - t0 * 1000;
    const tick = (now: number) => {
      const x = sound && audio.current && audioState === "ready" && !audio.current.paused ? audio.current.currentTime : (now - start) / 1000;
      if (x >= pv.duration) { setPlaying(false); seek(pv.duration); return; }
      setT(x); vs()?.seek(x); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line

  return (
    <>
      <div className="pvbar">
        <select value={variant} onChange={(e) => setVariant(e.target.value)}>{(pv?.variants ?? [variant]).map((v) => <option key={v}>{v}</option>)}</select>
        {pv && <span className="muted small">{pv.doc.aspect} · {pv.duration.toFixed(1)} s</span>}
        <span className="spacer" />
        <button className={`btn sm ${sound ? "" : "ghost"}`} onClick={() => setSound(!sound)} title="Hear the voice-over and music in the preview">
          {sound ? Icon.sound : Icon.mute} {sound ? (audioState === "loading" ? <>Mixing audio <Spinner /></> : audioState === "error" ? "Audio failed" : "Sound on") : "Sound off"}</button>
        <button className="btn sm ghost" onClick={onRefresh}>Refresh</button>
      </div>
      <div className="stagebox" ref={box}>
        {pv && <div style={{ width: pv.doc.width * scale, height: pv.doc.height * scale, borderRadius: 6, overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.5)" }}>
          <iframe ref={frame} title="preview" style={{ width: pv.doc.width, height: pv.doc.height, transform: `scale(${scale})`, transformOrigin: "0 0" }} /></div>}
        {!pv && state !== "error" && <div style={{ color: "#A5B4FC" }} className="row"><Spinner /> Preparing voice-over and preview…</div>}
        {state === "error" && <div className="banner bad" style={{ maxWidth: 520 }}>{err}</div>}
        {pv && state === "loading" && <div className="loading"><Spinner /> Updating preview</div>}
      </div>
      {audioUrl && <audio ref={audio} src={audioUrl} preload="auto" />}
      {pv && <div className="transport">
        <button className="play" onClick={() => setPlaying(!playing)} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>{playing ? Icon.pause : Icon.play}</button>
        <input type="range" min={0} max={pv.duration} step={0.01} value={Math.max(0, t)} onChange={(e) => { setPlaying(false); seek(+e.target.value); }} />
        <span className="time">{Math.max(0, t).toFixed(1)} / {pv.duration.toFixed(1)} s</span>
      </div>}
      {pv && <div className="timeline">{pv.scenes.map((s) => {
        const tone = pv.doc.scenes.find((x: Json) => x.id === s.id)?.tone ?? "light";
        return <div key={s.id} className={`${tone} ${selScene === s.id ? "sel" : ""}`} style={{ flex: s.end - s.start }} title={`${s.id} · ${(s.end - s.start).toFixed(1)} s`}
          onClick={() => { onPickScene(s.id); setPlaying(false); seek(s.start + 0.05); }}>{s.id}</div>;
      })}</div>}
      {pv && pv.lint.length > 0 && <div className="lint">{pv.lint.map((l, i) => <div key={i} className={l.level}>⚠ Scene <b>{l.scene}</b>: {l.message}</div>)}</div>}
      {pv && pv.warnings.length > 0 && <div className="lint">{pv.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
    </>
  );
}

function SceneInspector({ scene, onChange, cat, ctx, index }: { scene: Json; index: number; cat: Catalog; ctx: FormCtx; onChange(s: Json): void }) {
  const def = cat.scenes.find((d) => d.type === scene.type)!;
  const set = (k: string, v: Json) => onChange(v === undefined ? (({ [k]: _, ...rest }) => rest)(scene) : { ...scene, [k]: v });
  const tr = scene.transitionIn ?? def.meta.defaultTransition;
  const steps = def.schema.properties?.steps ? "steps" : def.schema.properties?.items ? "items" : null;
  const nSteps = steps ? (scene.props?.[steps]?.length ?? 0) : 0;
  const TONE: Record<string, string> = { light: "Light", dark: "Dark", brand: "Brand colour" };
  return (
    <>
      <div className="insp-head"><div className="row"><span className="sicon">{SCENE_ICON[scene.type]}</span><h3>Scene {index + 1} · {def.meta.label}</h3></div><p>{def.meta.description}</p></div>
      <div className="insp-sec">
        <h4>Voice-over</h4>
        {(scene.vo ?? []).map((l: Json, i: number) => (
          <div className="vo-line" key={i}>
            <textarea rows={2} value={l.text} onChange={(e) => set("vo", scene.vo.map((x: Json, j: number) => (j === i ? { ...x, text: e.target.value } : x)))} />
            <div className="vo-ctl">
              {steps && <select value={l.step ?? ""} onChange={(e) => set("vo", scene.vo.map((x: Json, j: number) => (j === i ? (e.target.value === "" ? (({ step: _, ...r }) => r)(x) : { ...x, step: +e.target.value }) : x)))}>
                <option value="">Across the whole scene</option>
                {Array.from({ length: nSteps }, (_, k) => <option key={k} value={k}>With {steps === "items" ? "card" : "step"} {k + 1}</option>)}</select>}
              <span className="spacer" /><button className="link sm danger" onClick={() => set("vo", scene.vo.filter((_: Json, j: number) => j !== i))}>Remove</button>
            </div>
          </div>
        ))}
        <button className="link sm" style={{ alignSelf: "flex-start" }} onClick={() => set("vo", [...(scene.vo ?? []), { text: "New line." }])}>+ Add a line</button>
        <p className="help">The scene lasts as long as the narration needs. Write numbers and names as they should be spoken.</p>
      </div>
      <div className="insp-sec"><h4>On screen</h4><SchemaForm schema={def.schema} value={scene.props} onChange={(p) => set("props", p)} ctx={ctx} /></div>
      <div className="insp-sec">
        <h4>Look and timing</h4>
        <div className="field"><div className="flabel">Background</div>
          <div className="seg">{cat.tones.map((t) => <button key={t} className={(scene.tone ?? "light") === t ? "on" : ""} onClick={() => set("tone", t)}>{TONE[t] ?? t}</button>)}</div></div>
        {index > 0 && <div className="field"><div className="flabel">Transition into this scene</div>
          <div className="row"><select value={tr.type} onChange={(e) => set("transitionIn", { ...tr, type: e.target.value })}>{cat.transitions.map((t) => <option key={t}>{t}</option>)}</select>
            {tr.type === "push" && <select value={tr.direction ?? "left"} onChange={(e) => set("transitionIn", { ...tr, direction: e.target.value })}>{["left", "right", "up", "down"].map((d) => <option key={d}>{d}</option>)}</select>}</div></div>}
        <div className="field"><div className="flabel">Music mood</div>
          <select value={scene.musicCue ?? def.meta.defaultMusicCue} onChange={(e) => set("musicCue", e.target.value)}>{cat.musicCues.map((m) => <option key={m}>{m}</option>)}</select></div>
        <div className="field"><div className="flabel">Length</div>
          <div className="row"><div className="seg">
            <button className={scene.duration?.mode !== "fixed" ? "on" : ""} onClick={() => set("duration", undefined)}>Fit narration</button>
            <button className={scene.duration?.mode === "fixed" ? "on" : ""} onClick={() => set("duration", { mode: "fixed", seconds: 5 })}>Fixed</button></div>
            {scene.duration?.mode === "fixed" && <input style={{ width: 90 }} type="number" min={1} max={60} step={0.5} value={scene.duration.seconds} onChange={(e) => set("duration", { mode: "fixed", seconds: +e.target.value })} />}</div></div>
        <label className="field check"><input type="checkbox" checked={!!scene.optional} onChange={(e) => set("optional", e.target.checked || undefined)} /> Drop this scene first when a format is too long</label>
      </div>
    </>
  );
}

function VideoSettings({ id, spec, cat, brand, update }: { id: string; spec: Json; cat: Catalog; brand: BrandKit | null; update(s: Json): void }) {
  const music = spec.music ?? { mode: "preset", preset: "uplifting-tech" };
  const voice = spec.voice ?? { provider: "kokoro", voice: "af_heart", speed: 0.94 };
  const setV = (i: number, v: Json) => update(setIn(spec, ["variants", i], v));
  const [playing, setPlaying] = useState(false);
  const listen = async () => {
    setPlaying(true);
    try { const a = new Audio(await api.voiceTest({ text: spec.scenes[0]?.vo?.[0]?.text ?? "Hello there.", voice: voice.voice, speed: voice.speed, project: id })); a.onended = () => setPlaying(false); await a.play(); }
    catch { setPlaying(false); }
  };
  return (
    <>
      <div className="insp-head"><h3>Video settings</h3><p>These apply to every scene and format.</p></div>
      <div className="insp-sec"><h4>Brand</h4>
        {brand && <a className="brandsum" href={`#/p/${id}/brand`}>
          <div className="logos"><div style={{ background: brand.colors.dark }}>{brand.urls.logoOnDark && <img src={brand.urls.logoOnDark} alt="" />}</div>
            <div style={{ background: brand.colors.light }}>{brand.urls.logoOnLight && <img src={brand.urls.logoOnLight} alt="" />}</div></div>
          <div className="row"><div style={{ flex: 1 }}><b>{brand.name}</b><div className="tiny muted">{brand.fonts.display?.family} · {brand.fonts.body?.family}</div></div><Swatches colors={brand.colors} /></div>
          <span className="link sm">Edit logo, colours, fonts or theme →</span></a>}</div>
      <div className="insp-sec"><h4>Sound</h4>
        <div className="field"><div className="flabel">Music</div>
          <select value={music.mode === "none" ? "none" : music.preset} onChange={(e) => update({ ...spec, music: e.target.value === "none" ? { mode: "none" } : { mode: "preset", preset: e.target.value, ...(e.target.value === "uplifting-tech" ? { bpm: 96 } : {}) } })}>
            {cat.presets.map((p) => <option key={p} value={p}>{p.replace(/-/g, " ")}</option>)}<option value="none">No music</option></select></div>
        <div className="field"><div className="flabel">Narrator</div>
          <div className="row"><select value={voice.voice} onChange={(e) => update({ ...spec, voice: { ...voice, provider: "kokoro", voice: e.target.value } })}>{cat.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
            <button className="btn" onClick={listen} disabled={playing}>{playing ? <Spinner /> : "▶"}</button></div></div>
        <div className="field"><div className="flabel"><span>Speaking speed</span><span className="muted">{(voice.speed ?? 0.94).toFixed(2)}×</span></div>
          <input type="range" min={0.8} max={1.15} step={0.01} value={voice.speed ?? 0.94} onChange={(e) => update({ ...spec, voice: { ...voice, provider: "kokoro", speed: +e.target.value } })} /></div>
      </div>
      <div className="insp-sec"><h4>Formats</h4>
        {spec.variants.map((v: Json, i: number) => (
          <div className="variant" key={i}>
            <div className="row"><b style={{ flex: 1 }}>{v.id}</b>
              <select style={{ width: 170 }} value={v.aspect} onChange={(e) => setV(i, { ...v, aspect: e.target.value, safeArea: e.target.value === "9:16" ? "reels" : "title" })}>
                {cat.aspects.map((a) => <option key={a} value={a}>{{ "16:9": "16:9 Landscape", "9:16": "9:16 Vertical", "1:1": "1:1 Square", "4:5": "4:5 Feed" }[a]}</option>)}</select>
              {spec.variants.length > 1 && <button className="btn ghost sm danger" onClick={() => update({ ...spec, variants: spec.variants.filter((_: Json, j: number) => j !== i) })}>✕</button>}</div>
            <div className="chips">{spec.scenes.map((s: Json, k: number) => {
              const on = !v.scenes || v.scenes.includes(s.id);
              return <label key={s.id} className="chipcheck"><input type="checkbox" checked={on} onChange={() => {
                const cur: string[] = v.scenes ?? spec.scenes.map((x: Json) => x.id);
                const next = on ? cur.filter((x) => x !== s.id) : spec.scenes.map((x: Json) => x.id).filter((x: string) => x === s.id || cur.includes(x));
                setV(i, { ...v, scenes: next.length === spec.scenes.length ? undefined : next });
              }} /> {k + 1}. {headlineOf(s).slice(0, 18) || s.id}</label>;
            })}</div>
            <div className="row"><span className="small muted" style={{ flex: 1 }}>Max length (optional)</span>
              <input style={{ width: 90 }} type="number" min={5} max={600} value={v.maxDuration ?? ""} placeholder="—" onChange={(e) => setV(i, { ...v, maxDuration: e.target.value === "" ? undefined : +e.target.value })} /><span className="small muted">s</span></div>
          </div>
        ))}
        <button className="link sm" style={{ alignSelf: "flex-start" }} onClick={() => {
          let n = 1; while (spec.variants.some((v: Json) => v.id === `format-${n}`)) n++;
          update({ ...spec, variants: [...spec.variants, { id: `format-${n}`, aspect: "1:1", safeArea: "title", loudness: -14 }] });
        }}>+ Add a format</button>
      </div>
    </>
  );
}

function RenderDialog({ id, spec, onClose, onDone }: { id: string; spec: Json; onClose(): void; onDone(): void }) {
  const [quality, setQuality] = useState(spec.quality ?? "standard");
  const [variants, setVariants] = useState<string[]>(spec.variants.map((v: Json) => v.id));
  const [all, setAll] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => { api.renders(id).then((js) => { const live = js.find((j) => j.status === "running" || j.status === "queued"); if (live) follow(live); }); }, []); // eslint-disable-line
  const follow = (j: Job) => {
    setJob(j);
    const es = new EventSource(`/api/renders/${j.id}/events`);
    es.onmessage = (m) => { const x = JSON.parse(m.data) as Job; setJob(x); if (x.status === "done" || x.status === "error") { es.close(); if (x.status === "done") onDone(); } };
  };
  const start = async () => follow(await api.render(id, { variants, quality, deliverables: all ? "all" : "none" }));
  const busy = job && (job.status === "running" || job.status === "queued");
  const Q = [
    { id: "draft", name: "Draft", desc: "Quick review copy, half size. About a minute." },
    { id: "standard", name: "Standard", desc: "Full HD, smooth motion. The usual final." },
    { id: "cinema", name: "Cinema", desc: "60 fps, smoothest motion. Takes longer." },
  ];
  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head"><h2 style={{ flex: 1 }}>Render video</h2><button className="btn ghost sm" onClick={onClose}>{busy ? "Hide" : "Close"}</button></div>
        <div className="dialog-body">
          <div className="f"><span className="l">Quality</span><div className="quality">{Q.map((q) => (
            <button key={q.id} className={`toggle-card ${quality === q.id ? "on" : ""}`} disabled={!!busy} onClick={() => setQuality(q.id)}><b>{q.name}</b><span>{q.desc}</span></button>))}</div></div>
          <div className="f"><span className="l">Formats</span><div className="chips">{spec.variants.map((v: Json) => (
            <label key={v.id} className="chipcheck"><input type="checkbox" disabled={!!busy} checked={variants.includes(v.id)} onChange={(e) => setVariants(e.target.checked ? [...variants, v.id] : variants.filter((x) => x !== v.id))} /> {v.id} · {v.aspect}</label>))}</div></div>
          <label className="field check"><input type="checkbox" disabled={!!busy} checked={all} onChange={(e) => setAll(e.target.checked)} /> Also export web, landing-page and hero versions, captions, thumbnails and audio stems</label>
          {job && <div className="progress">
            <div className="bar"><i style={{ width: `${Math.max(3, Math.round(job.progress * 100))}%` }} /></div>
            <div className="row"><span className={job.status === "error" ? "err small" : "muted small"} style={{ flex: 1 }}>{job.status === "error" ? job.error : job.message}</span><b className="small">{Math.round(job.progress * 100)}%</b></div>
          </div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            {job?.status === "done" && <a className="btn primary lg" href={`#/p/${id}/watch`}>{Icon.play} Watch video</a>}
            {job?.status !== "done" && <button className="btn primary lg" disabled={!!busy || !variants.length} onClick={start}>{busy ? <><Spinner /> Rendering…</> : "Start render"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

const SUGGEST = ["Make it shorter and punchier", "Rewrite it for a more formal audience", "Add a scene with a customer quote", "Make the opening hook stronger", "Use my screenshots more"];
function AskAgent({ id, job, onStarted, onClose }: { id: string; job: AgentJob | null; onStarted(j: string): void; onClose(): void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const running = job?.status === "running";
  const send = async () => {
    setBusy(true); setErr("");
    try { const j = await api.agent(id, { mode: "revise", instruction: text }); onStarted(j.id); setText(""); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="scrim" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><span className="orb live" style={{ width: 32, height: 32 }}>{Icon.wand}</span><h2 style={{ flex: 1 }}>Ask the AI agent</h2>
          {running && <button className="btn sm" onClick={() => job && api.stopAgent(job.id)}>{Icon.stop} Stop</button>}
          <button className="btn ghost sm" onClick={onClose}>{running ? "Hide" : "Close"}</button></div>
        <div className="drawer-body">
          {!running && <>
            <p className="muted" style={{ margin: 0 }}>Describe a change in plain words. The agent edits the scenes, checks timing and looks at the frames. Every save keeps a revision.</p>
            <textarea rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Make it 15 seconds for Instagram and end on the free-trial offer" />
            <div className="row wrap" style={{ gap: 6 }}>{SUGGEST.map((s) => <button key={s} className="chip-btn" onClick={() => setText(s)}>{s}</button>)}</div>
            {err && <div className="banner bad">{err}</div>}
            <button className="btn primary lg" disabled={!text.trim() || busy} onClick={send}>{busy ? <Spinner /> : Icon.wand} Make the change</button>
          </>}
          {job && <>
            <div className="brief"><span className="tiny muted">{job.mode === "create" ? "Creating the video" : "You asked"}</span><p>{job.mode === "create" ? "From your idea" : job.instruction}</p></div>
            <AgentLog job={job} compact />
            {!running && job.summary && <div className={`asummary ${job.status}`}><b>{job.status === "done" ? "Done" : "Note"}</b><p>{plain(job.summary)}</p></div>}
            {!running && <button className="btn" onClick={() => navigate(`#/p/${id}/build/${job.id}`)}>See all steps and frames</button>}
          </>}
        </div>
      </div>
    </div>
  );
}
