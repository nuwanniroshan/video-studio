import { useEffect, useMemo, useState } from "react";
import { api, navigate, type BrandKit, type FontOpt } from "../api.ts";
import { FilePick, Spinner, Swatches } from "../components/ui.tsx";

export function Brands() {
  const [brands, setBrands] = useState<BrandKit[] | null>(null);
  useEffect(() => { api.brandkits().then(setBrands); }, []);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Brand kits</h1><p>Logos, colours, fonts and voice. Every video uses one brand kit.</p></div><span className="spacer" />
        <a className="btn primary" href="#/brands/new">+ New brand</a></div>
      <div className="grid-cards">
        {brands?.map((b) => (
          <a key={b.id} href={`#/brands/${b.id}`} className="card bcard">
            <div className="logos">
              <div style={{ background: b.colors.dark }}>{b.urls.logoOnDark && <img src={b.urls.logoOnDark} alt="" />}</div>
              <div style={{ background: b.colors.light }}>{b.urls.logoOnLight && <img src={b.urls.logoOnLight} alt="" />}</div>
            </div>
            <div className="body">
              <div className="row"><h3 style={{ flex: 1 }}>{b.name}</h3><Swatches kit={b} /></div>
              <span className="muted small">{b.fonts.display?.family} · {b.fonts.body?.family} · voice {b.voice?.voice ?? "default"}</span>
            </div>
          </a>
        ))}
        <a href="#/brands/new" className="empty" style={{ display: "grid", placeItems: "center", color: "var(--accent)", fontWeight: 600, minHeight: 170 }}>+ Create a brand kit</a>
      </div>
    </div>
  );
}

const DEFAULT_BASE = { primary: "#4F46E5", accent: "#0EA5E9", dark: "#0B1020", light: "#F6F7FB", ink: "#0F1222" };
const COLOR_HELP: Record<string, string> = { primary: "Buttons, accents", accent: "Highlights", dark: "Dark scenes", light: "Light scenes", ink: "Text" };

interface Draft { name: string; base: typeof DEFAULT_BASE; fonts: Record<"display" | "body" | "mono", { library?: string; family?: string; file?: string }>;
  voice: string; speed: number; pron: { term: string; kind: "respell" | "ipa"; value: string }[]; ctaUrl: string; music: string }

export function BrandEditor({ id }: { id: string | null }) {
  const [fonts, setFonts] = useState<FontOpt[]>([]);
  const [voices, setVoices] = useState<{ id: string; label: string }[]>([]);
  const [presets, setPresets] = useState<string[]>([]);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [d, setD] = useState<Draft>({ name: "", base: DEFAULT_BASE, fonts: { display: { library: "onest" }, body: { library: "opensans" }, mono: { library: "jetbrains" } },
    voice: "af_heart", speed: 0.94, pron: [], ctaUrl: "", music: "uplifting-tech" });
  const [pending, setPending] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    api.fonts().then(setFonts);
    api.catalog().then((c) => { setVoices(c.voices); setPresets(c.presets); });
    if (id) api.brandkit(id).then((k) => {
      setKit(k);
      const libOf = (role: string) => { const f = k.fonts[role]; return { library: undefined as string | undefined, family: f?.family, file: f?.file }; };
      setD({ name: k.name, base: (k.base ?? { primary: k.colors.primary, accent: k.colors.accent, dark: k.colors.dark, light: k.colors.light, ink: k.colors.ink }) as typeof DEFAULT_BASE,
        fonts: { display: libOf("display"), body: libOf("body"), mono: libOf("mono") }, voice: k.voice?.voice ?? "af_heart", speed: k.voice?.speed ?? 0.94,
        pron: Object.entries(k.pronunciations ?? {}).map(([term, v]) => ({ term, kind: v.ipa ? "ipa" : "respell", value: (v.ipa ?? v.respell)! })),
        ctaUrl: k.cta?.url ?? "", music: k.music?.preset ?? "uplifting-tech" });
    });
  }, [id]);
  // match existing brand fonts to library entries by family so the selects show them
  useEffect(() => {
    if (!fonts.length || !kit) return;
    setD((x) => ({ ...x, fonts: Object.fromEntries((["display", "body", "mono"] as const).map((r) => {
      const lib = fonts.find((f) => f.family === x.fonts[r].family);
      return [r, lib ? { library: lib.id } : x.fonts[r]];
    })) as Draft["fonts"] }));
  }, [fonts, kit]);

  // load font faces for the live preview
  const faceUrl = (role: "display" | "body" | "mono") => {
    const f = d.fonts[role];
    if (pending[`font${role[0].toUpperCase()}${role.slice(1)}`]) return URL.createObjectURL(pending[`font${role[0].toUpperCase()}${role.slice(1)}`]);
    if (f.library) return fonts.find((x) => x.id === f.library)?.url;
    return kit?.urls.fonts[role];
  };
  const [faces, setFaces] = useState<Record<string, string>>({});
  useEffect(() => {
    (["display", "body", "mono"] as const).forEach(async (r) => {
      const url = faceUrl(r);
      if (!url) return;
      const name = `bp-${r}-${btoa(url).replace(/[^a-z0-9]/gi, "").slice(-16)}`;
      if (faces[r] === name) return;
      try { const ff = new FontFace(name, `url(${url})`); await ff.load(); document.fonts.add(ff); setFaces((x) => ({ ...x, [r]: name })); } catch { /* ignore */ }
    });
  }, [d.fonts, fonts, kit, pending]); // eslint-disable-line

  const logo = (which: "logoOnDark" | "logoOnLight") => pending[which] ? URL.createObjectURL(pending[which]) : kit?.urls[which];
  const palette = useMemo(() => {
    const mix = (a: string, b: string, t: number) => { const h = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)); const x = h(a), y = h(b);
      return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
    const p = d.base.primary;
    return [mix(p, "#ffffff", 0.9), mix(p, "#ffffff", 0.6), mix(p, "#ffffff", 0.18), p, mix(p, "#000000", 0.12), mix(p, "#000000", 0.28), d.base.accent, d.base.dark, d.base.ink, d.base.light];
  }, [d.base]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const body = { name: d.name, base: d.base, fonts: d.fonts, voice: { voice: d.voice, speed: d.speed }, ctaUrl: d.ctaUrl || undefined, music: d.music,
        pronunciations: Object.fromEntries(d.pron.filter((p) => p.term.trim() && p.value.trim()).map((p) => [p.term.trim(), p.kind === "ipa" ? { ipa: p.value.trim() } : { respell: p.value.trim() }])) };
      // fonts uploaded as files are attached after the brand exists
      for (const r of ["display", "body", "mono"] as const) if (pending[`font${r[0].toUpperCase()}${r.slice(1)}`]) body.fonts[r] = { library: "onest" };
      let k = await api.saveBrand(id, body);
      for (const [kind, f] of Object.entries(pending)) k = await api.brandFile(k.id, kind, f);
      if (Object.keys(pending).some((x) => x.startsWith("font"))) {
        const fontsAfter = Object.fromEntries((["display", "body", "mono"] as const).map((r) => [r, pending[`font${r[0].toUpperCase()}${r.slice(1)}`] ? { family: k.fonts[r].family, file: k.fonts[r].file } : body.fonts[r]]));
        k = await api.saveBrand(k.id, { ...body, fonts: fontsAfter });
      }
      setPending({}); setKit(k);
      setMsg({ kind: "ok", text: "Saved. New videos with this brand use it straight away." });
      if (!id) navigate(`#/brands/${k.id}`);
    } catch (e) { setMsg({ kind: "bad", text: (e as Error).message + ((e as any).issues ? `: ${(e as any).issues.map((i: any) => i.message).join(", ")}` : "") }); }
    setBusy(false);
  };
  const listen = async (key: string, text: string, pron?: Draft["pron"]) => {
    setPlaying(key);
    try {
      const pr = Object.fromEntries((pron ?? d.pron).filter((p) => p.term && p.value).map((p) => [p.term, p.kind === "ipa" ? { ipa: p.value } : { respell: p.value }]));
      const a = new Audio(await api.voiceTest({ text, voice: d.voice, speed: d.speed, pronunciations: pr }));
      a.onended = () => setPlaying(null); await a.play();
    } catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); setPlaying(null); }
  };
  const fontSel = (role: "display" | "body" | "mono", label: string) => {
    const key = `font${role[0].toUpperCase()}${role.slice(1)}`;
    const cur = d.fonts[role];
    return (
      <div className="fontrow">
        <span className="l small" style={{ fontWeight: 600 }}>{label}</span>
        <div className="col" style={{ gap: 6 }}>
          <div className="row">
            <select value={pending[key] ? "__upload" : cur.library ?? "__current"} onChange={(e) => { const v = e.target.value; if (v === "__upload" || v === "__current") return;
              setPending((p) => { const { [key]: _, ...rest } = p; return rest; }); setD({ ...d, fonts: { ...d.fonts, [role]: { library: v } } }); }}>
              {!cur.library && !pending[key] && cur.family && <option value="__current">{cur.family} (uploaded)</option>}
              {pending[key] && <option value="__upload">{pending[key].name} (new upload)</option>}
              {fonts.filter((f) => f.roles.includes(role)).map((f) => <option key={f.id} value={f.id}>{f.family} · {f.style}</option>)}
            </select>
            <FilePick accept=".ttf,.otf,.woff,.woff2" onFile={(f) => setPending((p) => ({ ...p, [key]: f }))}><button className="btn sm" type="button">Upload…</button></FilePick>
          </div>
          <div className="fontsample" style={{ fontFamily: faces[role] ? `"${faces[role]}"` : undefined, fontWeight: role === "display" ? 600 : 400, fontSize: role === "display" ? 24 : 16 }}>
            {role === "mono" ? "NEW · 01 / KICKER" : role === "display" ? "Payroll, done in minutes." : "Hours, leave and allowances flow straight in."}</div>
        </div>
      </div>
    );
  };
  const ff = (r: string, fb: string) => (faces[r] ? `"${faces[r]}", ${fb}` : fb);

  return (
    <div className="page">
      <div className="page-head"><div><a href="#/brands" className="muted small">← Brand kits</a><h1>{id ? d.name || "Brand kit" : "New brand kit"}</h1></div><span className="spacer" />
        {id && id !== "luraplus" && <button className="btn ghost danger" onClick={async () => { if (confirm("Delete this brand kit?")) { await api.deleteBrand(id); navigate("#/brands"); } }}>Delete</button>}
        <button className="btn primary" disabled={busy || !d.name.trim()} onClick={save}>{busy ? <><Spinner /> Saving…</> : id ? "Save changes" : "Create brand"}</button></div>
      {msg && <div className={`banner ${msg.kind === "ok" ? "info" : "bad"}`} style={{ marginBottom: 16 }}>{msg.text}</div>}
      <div className="bedit">
        <div className="col" style={{ gap: 16 }}>
          <div className="card section">
            <h3>Identity</h3>
            <label className="f"><span className="l">Brand name *</span><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Acme" /></label>
            <div className="two">
              {(["logoOnDark", "logoOnLight"] as const).map((w) => (
                <div className="f" key={w}><span className="l">Logo for {w === "logoOnDark" ? "dark" : "light"} backgrounds</span>
                  <FilePick accept="image/png,image/svg+xml,image/webp" onFile={(f) => setPending((p) => ({ ...p, [w]: f }))}>
                    <div className="logo-drop" style={{ background: w === "logoOnDark" ? d.base.dark : d.base.light, color: w === "logoOnDark" ? "#fff" : "#333" }}>
                      {logo(w) ? <img src={logo(w)} alt="" /> : <b>Upload logo</b>}<span className="hint">PNG or SVG, transparent background</span></div>
                  </FilePick></div>
              ))}
            </div>
            <label className="f"><span className="l">Website (shown on the end card)</span><input value={d.ctaUrl} onChange={(e) => setD({ ...d, ctaUrl: e.target.value })} placeholder="acme.com" /></label>
          </div>
          <div className="card section">
            <h3>Colours</h3>
            <div className="colors">{(Object.keys(DEFAULT_BASE) as (keyof typeof DEFAULT_BASE)[]).map((k) => (
              <div className="color-in" key={k}><span className="l small" style={{ fontWeight: 600, textTransform: "capitalize" }}>{k}</span>
                <div className="cin"><input type="color" value={d.base[k]} onChange={(e) => setD({ ...d, base: { ...d.base, [k]: e.target.value.toUpperCase() } })} />
                  <input type="text" value={d.base[k]} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && setD({ ...d, base: { ...d.base, [k]: e.target.value.toUpperCase() } })} /></div>
                <span className="tiny muted">{COLOR_HELP[k]}</span></div>))}
            </div>
            <div className="f"><span className="l">Generated palette</span><div className="palette">{palette.map((c, i) => <i key={i} style={{ background: c }} />)}</div>
              <span className="help">Tints, shades and greys are derived automatically from these five colours.</span></div>
          </div>
          <div className="card section">
            <h3>Typography</h3>
            {fontSel("display", "Headlines")}{fontSel("body", "Body")}{fontSel("mono", "Labels")}
            <span className="help">Only upload fonts you're licensed to use in video.</span>
          </div>
          <div className="card section">
            <h3>Voice and music</h3>
            <div className="two">
              <label className="f"><span className="l">Narrator voice</span><select value={d.voice} onChange={(e) => setD({ ...d, voice: e.target.value })}>{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
              <label className="f"><span className="l">Default music</span><select value={d.music} onChange={(e) => setD({ ...d, music: e.target.value })}>{presets.map((p) => <option key={p} value={p}>{p.replace(/-/g, " ")}</option>)}</select></label>
            </div>
            <div className="f"><span className="l">Speaking speed <span className="muted">{d.speed.toFixed(2)}×</span></span>
              <div className="row"><input type="range" min={0.8} max={1.15} step={0.01} value={d.speed} onChange={(e) => setD({ ...d, speed: +e.target.value })} />
                <button className="btn" disabled={!!playing} onClick={() => listen("voice", `Welcome to ${d.name || "our product"}. Here's what's new.`)}>{playing === "voice" ? <Spinner /> : "▶"} Listen</button></div></div>
          </div>
          <div className="card section">
            <div className="row"><h3 style={{ flex: 1 }}>Pronunciation</h3><button className="link sm" onClick={() => setD({ ...d, pron: [...d.pron, { term: "", kind: "respell", value: "" }] })}>+ Add word</button></div>
            <p className="help">Teach the narrator brand names. "Sounds like" uses plain spelling (e.g. SaaS → sass); IPA is exact (e.g. Lura → lˈuːɹə). Captions keep your spelling.</p>
            {d.pron.map((p, i) => (
              <div className="dict" key={i}>
                <input value={p.term} placeholder="Word" onChange={(e) => setD({ ...d, pron: d.pron.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)) })} />
                <select value={p.kind} onChange={(e) => setD({ ...d, pron: d.pron.map((x, j) => (j === i ? { ...x, kind: e.target.value as "ipa" | "respell" } : x)) })}><option value="respell">Sounds like</option><option value="ipa">IPA</option></select>
                <input value={p.value} placeholder={p.kind === "ipa" ? "lˈuːɹə" : "loo-rah"} onChange={(e) => setD({ ...d, pron: d.pron.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                <button className="btn sm" title="Listen" disabled={!p.term || !!playing} onClick={() => listen(`p${i}`, `Say hello to ${p.term}.`, [p])}>{playing === `p${i}` ? <Spinner /> : "▶"}</button>
                <button className="btn ghost sm" onClick={() => setD({ ...d, pron: d.pron.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
          </div>
        </div>
        <div className="bprev">
          <span className="l small" style={{ fontWeight: 700, color: "var(--faint)", letterSpacing: ".07em", textTransform: "uppercase" }}>Preview</span>
          <div className="bp-card" style={{ background: `radial-gradient(120% 80% at 75% 35%, ${d.base.primary}26, transparent 60%), ${d.base.dark}`, color: "#fff" }}>
            <div className="grid" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)" }} />
            {logo("logoOnDark") && <img className="lg" src={logo("logoOnDark")} alt="" />}
            <div className="k" style={{ fontFamily: ff("mono", "monospace"), color: palette[2] }}><i />Introducing</div>
            <div className="h" style={{ fontFamily: ff("display", "sans-serif") }}>{d.name || "Your brand"}, <span style={{ opacity: .4 }}>made simple.</span></div>
            <div className="s" style={{ fontFamily: ff("body", "sans-serif") }}>Everything your team needs, in one place.</div>
          </div>
          <div className="bp-card" style={{ background: d.base.light, color: d.base.ink }}>
            <div className="grid" style={{ backgroundImage: `linear-gradient(${d.base.ink}0A 1px, transparent 1px), linear-gradient(90deg, ${d.base.ink}0A 1px, transparent 1px)` }} />
            {logo("logoOnLight") && <img className="lg" src={logo("logoOnLight")} alt="" />}
            <div className="k" style={{ fontFamily: ff("mono", "monospace"), color: d.base.primary }}><i />New feature</div>
            <div className="h" style={{ fontFamily: ff("display", "sans-serif") }}>Payroll, <span style={{ color: d.base.primary }}>done in minutes.</span></div>
            <div className="s" style={{ fontFamily: ff("body", "sans-serif") }}>Hours, leave and allowances flow straight in.</div>
            <span className="btnp" style={{ background: d.base.primary, color: "#fff", fontFamily: ff("display", "sans-serif") }}>Book a demo →</span>
          </div>
        </div>
      </div>
    </div>
  );
}
