import { useEffect, useMemo, useRef, useState } from "react";
import { api, navigate, type AgentStatus, type FontOpt, type NewVideo, type Template, type Theme } from "../api.ts";
import { BrandFields, DEFAULT_BASE, type CustomBrand, type PendingFiles } from "../components/BrandFields.tsx";
import { FilePick, FormatPicker, Icon, LookPreview, Spinner, ThemeGrid, mixHex } from "../components/ui.tsx";

const EXAMPLES = [
  { label: "Coffee subscription", name: "Brewly", idea: "Brewly is a coffee subscription for small offices. Teams waste time ordering coffee and always run out.\n- Fresh beans delivered every week\n- One invoice for the whole office\n- Pause or change anytime\nOffices save 30% on coffee." },
  { label: "Feature launch", name: "Tasko", idea: "Launch dark mode in Tasko, our project-management app. It's easier on the eyes for late-night planning, follows your system setting automatically, and works on web, iOS and Android." },
  { label: "Studio opening", name: "Stillpoint Yoga", idea: "A 15-second teaser: Stillpoint Yoga opens its new studio in Austin on March 3. First week of classes is free. Book on the website." },
  { label: "How-to", name: "Ledgerly", idea: "How to send your first invoice in Ledgerly in three steps: add your client, add the work you did, and press send. Ledgerly reminds the client automatically until they pay." },
];
const LENGTHS = [15, 30, 45, 60, 90];

export function Create() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [fonts, setFonts] = useState<FontOpt[]>([]);
  const [voices, setVoices] = useState<{ id: string; label: string }[]>([]);
  const [presets, setPresets] = useState<string[]>([]);
  const [agent, setAgent] = useState<AgentStatus | null>(null);

  const [idea, setIdea] = useState("");
  const [name, setName] = useState("");
  const [details, setDetails] = useState(false);
  const [url, setUrl] = useState(""); const [cta, setCta] = useState(""); const [audience, setAudience] = useState("");
  const [shots, setShots] = useState<{ ref: string; url: string; name: string }[]>([]);
  const [template, setTemplate] = useState<string>("");
  const [brandMode, setBrandMode] = useState<"auto" | "theme" | "custom">("auto");
  const [theme, setTheme] = useState("midnight");
  const [custom, setCustom] = useState<CustomBrand>({ name: "", base: DEFAULT_BASE, fonts: { display: { library: "onest" }, body: { library: "inter" }, mono: { library: "jetbrains" } } });
  const [files, setFiles] = useState<PendingFiles>({});
  const [voice, setVoice] = useState<string | null>(null);
  const [speed, setSpeed] = useState(0.94);
  const [music, setMusic] = useState<string | null>(null);
  const [length, setLength] = useState(30);
  const [formats, setFormats] = useState<string[]>(["16:9"]);
  const [useAgent, setUseAgent] = useState(true);
  const [model, setModel] = useState("sonnet");
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>();

  useEffect(() => {
    api.themes().then(setThemes); api.templates().then(setTemplates); api.fonts().then(setFonts);
    api.catalog().then((c) => { setVoices(c.voices); setPresets(c.presets); });
    api.agentStatus().then((s) => { setAgent(s); if (!s.available) setUseAgent(false); }).catch(() => setUseAgent(false));
    if (new URLSearchParams(location.hash.split("?")[1] ?? "").get("template")) setBrandMode("theme");
    const t = new URLSearchParams(location.hash.split("?")[1] ?? "").get("template"); if (t) setTemplate(t);
  }, []);
  useEffect(() => { const u = files.logo && URL.createObjectURL(files.logo); setLogoUrl(u); }, [files.logo]);
  // the brand name follows the product name until the user edits it
  const prevName = useRef("");
  useEffect(() => { const prev = prevName.current; setCustom((c) => (c.name === prev ? { ...c, name } : c)); prevName.current = name; }, [name]);

  const aiOn = !!agent?.available && useAgent;
  const mode = brandMode === "auto" && !aiOn ? "theme" : brandMode;
  const th = themes.find((t) => t.id === theme);
  const tpl = templates.find((t) => t.id === template);
  const effVoice = voice ?? th?.voice.voice ?? "af_heart";
  const effMusic = music ?? (mode === "theme" ? th?.music : undefined) ?? (mode === "auto" ? "auto" : "uplifting-tech");
  const look = useMemo(() => {
    if (mode !== "custom" && th) return { colors: th.colors, display: th.fontUrls.display, body: th.fontUrls.body };
    const b = custom.base, f = (r: "display" | "body") => fonts.find((x) => x.id === custom.fonts[r]?.library)?.url;
    return { colors: { ...b, primary400: mixHex(b.primary, "#FFFFFF", 0.18), primary50: mixHex(b.primary, "#FFFFFF", 0.9) }, display: f("display"), body: f("body") };
  }, [mode, th, custom, fonts]);

  const canCreate = (idea.trim().length >= 12 || !!tpl) && (mode !== "custom" || custom.name.trim() || name.trim());
  const listen = async () => {
    setPlaying(true);
    try { const a = new Audio(await api.voiceTest({ text: `Meet ${name || "your product"}. ${idea.split(/[.!?\n]/)[0] || "Here's what's new."}`.slice(0, 200), voice: effVoice, speed })); a.onended = () => setPlaying(false); await a.play(); }
    catch { setPlaying(false); }
  };
  const create = async () => {
    setErr("");
    try {
      setBusy("Setting up your project…");
      const brand: NewVideo["brand"] = mode === "auto" ? { theme: "auto", name: name.trim() || undefined } : mode === "theme" ? { theme, name: name.trim() || undefined } : { custom: { ...custom, name: custom.name.trim() || name.trim() } };
      const body: NewVideo = { idea: idea.trim(), name: name.trim() || undefined, url: url.trim() || undefined, cta: cta.trim() || undefined, audience: audience.trim() || undefined,
        length, formats, voice: effVoice, speed, music: effMusic === "auto" ? undefined : effMusic, template: template || undefined, screenshots: shots.map((s) => s.ref), brand };
      const { id } = await api.newVideo(body);
      if (mode === "custom") {
        setBusy("Uploading your brand…");
        for (const [kind, f] of Object.entries(files)) if (f) await api.brandFile(id, kind, f);
      }
      if (useAgent && agent?.available && (idea.trim() || tpl)) {
        setBusy("Starting the agent…");
        const j = await api.agent(id, { mode: "create", model });
        navigate(`#/p/${id}/build/${j.id}`);
      } else navigate(`#/p/${id}`);
    } catch (e) { setErr((e as Error).message + ((e as any).issues ? ": " + (e as any).issues.map((i: any) => `${i.path} ${i.message}`).join("; ") : "")); setBusy(""); }
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>New video</h1>
        <p>Describe your idea and choose the look and sound. {agent?.available ? "The AI agent writes the script, picks and designs every scene, then checks the frames." : "We write a first storyboard you can edit."}</p></div></div>
      <div className="create">
        <div className="col" style={{ gap: 16 }}>
          <section className="card section">
            <div className="section-title"><span className="n">1</span><h3>What's the video about?</h3></div>
            <textarea className="idea-text" rows={6} value={idea} onChange={(e) => setIdea(e.target.value)}
              placeholder={"Describe the product, the message and what viewers should do.\nList key points on separate lines with a dash if you like.\n\nExample: Brewly is a coffee subscription for small offices. Teams waste time ordering coffee…"} />
            <div className="row wrap" style={{ gap: 6 }}><span className="tiny muted">Try:</span>
              {EXAMPLES.map((x) => <button key={x.label} type="button" className="chip-btn" onClick={() => { setIdea(x.idea); setName(x.name); }}>{x.label}</button>)}</div>
            <div className="two">
              <label className="f"><span className="l">Product or company name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brewly" /></label>
              <label className="f"><span className="l">Website</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="brewly.co" /></label>
            </div>
            {!details ? <button type="button" className="link sm" style={{ alignSelf: "flex-start" }} onClick={() => setDetails(true)}>+ Audience and call to action</button> : (
              <div className="two">
                <label className="f"><span className="l">Who is it for?</span><input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. office managers" /></label>
                <label className="f"><span className="l">Button text</span><input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="e.g. Start free trial" /></label>
              </div>)}
            <div className="f"><span className="l">Images <span className="muted" style={{ fontWeight: 500 }}>optional · screenshots or photos</span></span>
              <div className="shots">
                {shots.map((s, i) => <div className="shot" key={s.ref} title={s.name}><img src={s.url} alt="" /><button onClick={() => setShots(shots.filter((_, j) => j !== i))}>✕</button></div>)}
                {shots.length < 8 && <FilePick className="shot add" accept="image/png,image/jpeg,image/webp" onFile={async (f) => { const r = await api.upload(f); setShots((x) => [...x, { ref: r.ref, url: URL.createObjectURL(f), name: f.name }]); }}>+ Add</FilePick>}
              </div>
              <span className="help">Real product screenshots make the strongest videos. The agent decides where each one fits.</span></div>
          </section>

          <section className="card section">
            <div className="section-title"><span className="n">2</span><h3>Starting point</h3></div>
            <div className="starts-row">
              <button type="button" className={`sp ${!template ? "on" : ""}`} onClick={() => setTemplate("")}>
                <div className="sp-art agentic">{Icon.wand}</div><b>{aiOn ? "Original" : "From my idea"}</b>
                <span>{aiOn ? "Designed from scratch for your idea" : "A first draft from your description"}</span></button>
              {templates.map((t) => (
                <button key={t.id} type="button" className={`sp ${template === t.id ? "on" : ""}`} onClick={() => { setTemplate(t.id); if (t.theme && brandMode !== "custom") { setBrandMode("theme"); setTheme(t.theme); } if (t.formats?.length) setFormats(t.formats.slice(0, 2)); }}>
                  <div className="sp-art" style={{ backgroundImage: t.thumbnail ? `url(${t.thumbnail})` : undefined }} /><b>{t.name}</b><span>{t.length} · {t.category}</span></button>
              ))}
            </div>
            {!tpl && aiOn && <p className="help">The agent invents the concept, layouts, illustrations and motion for this idea. Or pick a template above to start from a proven structure.</p>}
            {tpl && <p className="help">{tpl.description} {agent?.available && useAgent ? "The agent rewrites it for your idea." : "Edit the words in the editor after creating."}</p>}
          </section>

          <section className="card section">
            <div className="section-title"><span className="n">3</span><h3>Branding</h3><span className="spacer" />
              <div className="seg">{aiOn && <button className={mode === "auto" ? "on" : ""} onClick={() => setBrandMode("auto")}>Designed for my idea</button>}
                <button className={mode === "theme" ? "on" : ""} onClick={() => setBrandMode("theme")}>Choose a theme</button>
                <button className={mode === "custom" ? "on" : ""} onClick={() => setBrandMode("custom")}>Use my brand</button></div></div>
            {mode === "auto" ? <p className="help">The agent chooses colours, fonts and music that suit the idea (a café gets warm tones and a serif, a fintech gets something crisp). You can change everything later on the video's Brand page.</p>
            : mode === "theme" ? <>
              <ThemeGrid themes={themes} value={theme} onChange={setTheme} name={name || "Your brand"} />
              <p className="help">The brand belongs to this video only. You can upload a logo or tweak colours later in the video's Brand page.</p>
            </> : <BrandFields value={custom} onChange={setCustom} files={files} setFiles={setFiles} fonts={fonts} />}
          </section>

          <section className="card section">
            <div className="section-title"><span className="n">4</span><h3>Voice and music</h3></div>
            <div className="two">
              <div className="f"><span className="l">Narrator</span><div className="row">
                <select value={effVoice} onChange={(e) => setVoice(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
                <button className="btn" onClick={listen} disabled={playing}>{playing ? <Spinner /> : Icon.play} Listen</button></div></div>
              <div className="f"><span className="l">Speaking speed <span className="muted" style={{ fontWeight: 500 }}>{speed.toFixed(2)}×</span></span>
                <input type="range" min={0.8} max={1.15} step={0.01} value={speed} onChange={(e) => setSpeed(+e.target.value)} style={{ height: 38 }} /></div>
            </div>
            <div className="f"><span className="l">Music</span><div className="seg">
              {mode === "auto" && <button className={effMusic === "auto" ? "on" : ""} onClick={() => setMusic(null)}>Agent's choice</button>}
              {presets.map((p) => <button key={p} className={effMusic === p ? "on" : ""} onClick={() => setMusic(p)}>{p === "uplifting-tech" ? "Uplifting" : p === "calm-explainer" ? "Calm" : p.replace(/-/g, " ")}</button>)}
              <button className={effMusic === "none" ? "on" : ""} onClick={() => setMusic("none")}>No music</button></div></div>
          </section>

          <section className="card section">
            <div className="section-title"><span className="n">5</span><h3>Size and length</h3></div>
            <div className="f"><span className="l">Video sizes</span><FormatPicker value={formats} onChange={setFormats} />
              <span className="help">Each size is laid out for its screen. Vertical and square versions get social loudness.</span></div>
            <div className="f"><span className="l">Length</span><div className="seg">{LENGTHS.map((n) => <button key={n} className={length === n ? "on" : ""} onClick={() => setLength(n)}>{n} s</button>)}</div>
              <span className="help">A target: scenes last as long as their narration.</span></div>
          </section>
        </div>

        <aside className="card summary">
          {mode === "auto" ? <div className="look-auto">{Icon.wand}<b>{name || "Your brand"}</b><span>Colours, fonts and music designed for your idea</span></div> :
          <LookPreview colors={look.colors} display={look.display} body={look.body} name={(mode === "custom" ? custom.name : name) || "Your brand"} logoDark={mode === "custom" ? logoUrl : undefined} />}
          <dl>
            <dt>Brand</dt><dd>{mode === "auto" ? "Designed by the agent" : mode === "theme" ? `${th?.name ?? ""} theme` : custom.name || name || "Your brand"}</dd>
            <dt>Start</dt><dd>{tpl ? `${tpl.name} template` : aiOn ? "Original" : "Draft from idea"}</dd>
            <dt>Sizes</dt><dd>{formats.join(" · ")}</dd>
            <dt>Length</dt><dd>~{length} s</dd>
            <dt>Voice</dt><dd>{voices.find((v) => v.id === effVoice)?.label.split(" (")[0] ?? effVoice} · {effMusic === "none" ? "no music" : effMusic === "auto" ? "music chosen by the agent" : effMusic.replace(/-/g, " ")}</dd>
          </dl>
          <div className={`agentbox ${agent?.available ? "" : "off"}`}>
            {agent === null ? <span className="row small muted"><Spinner /> Checking the AI agent…</span> : agent.available ? <>
              <label className="row" style={{ gap: 8, fontWeight: 600 }}><input type="checkbox" checked={useAgent} onChange={(e) => setUseAgent(e.target.checked)} /> {Icon.wand} Use the AI agent</label>
              {useAgent && <div className="seg sm">{agent.models.map((m) => <button key={m.id} className={model === m.id ? "on" : ""} onClick={() => setModel(m.id)}>{m.label}</button>)}</div>}
              <span className="tiny muted">{useAgent ? "Runs Claude with your Claude Code login. Takes 2–4 minutes; you can watch it work." : "You'll get an instant rule-based draft instead."}</span>
            </> : <><b className="small">AI agent unavailable</b><span className="tiny muted">{agent.detail} You'll get an instant draft you can edit.</span></>}
          </div>
          {err && <div className="banner bad">{err}</div>}
          <button className="btn primary lg" disabled={!canCreate || !!busy} onClick={create}>
            {busy ? <><Spinner /> {busy}</> : useAgent && agent?.available ? <>{Icon.wand} Create with AI</> : "Create video"}</button>
          {!canCreate && <span className="help" style={{ textAlign: "center" }}>{mode === "custom" && !custom.name.trim() && !name.trim() ? "Add your brand name." : "Describe your idea (or pick a template) to continue."}</span>}
        </aside>
      </div>
    </div>
  );
}
