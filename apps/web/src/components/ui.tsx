import { useEffect, useRef, useState, type ReactNode } from "react";
import { ASPECT_NAME, ASPECT_USE, type Base, type Theme } from "../api.ts";

export const Icon = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>,
  grid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
  brush: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/></svg>,
  spark: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>,
  play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>,
  sound: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>,
  mute: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/></svg>,
  film: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>,
  wand: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 20 11-11M14 4v3M19 9h-3M17.5 5.5l-2 2M18 14v2M20 15h-4M8 3v2M9 4H7"/></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m5 12 5 5 9-10"/></svg>,
  stop: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>,
  upload: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>,
  palette: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.3-1.1-1.5-1.1-2.6 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/></svg>,
  claude: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16v11H9l-5 4z"/></svg>,
};

export function FrameIcon({ aspect, size = 34 }: { aspect: string; size?: number }) {
  const [w, h] = aspect.split(":").map(Number);
  const k = size / Math.max(w, h);
  return <div className="frame" style={{ width: w * k, height: h * k }} />;
}

export function FormatPicker({ value, onChange, options = ["16:9", "9:16", "1:1", "4:5"] }: { value: string[]; onChange(v: string[]): void; options?: string[] }) {
  return (
    <div className="formats">
      {options.map((a) => {
        const on = value.includes(a);
        return (
          <button key={a} type="button" className={`toggle-card ${on ? "on" : ""}`} onClick={() => onChange(on ? (value.length > 1 ? value.filter((x) => x !== a) : value) : [...value, a])}>
            <div style={{ height: 36, display: "grid", placeItems: "center" }}><FrameIcon aspect={a} /></div>
            <b className="small">{ASPECT_NAME[a]} {a}</b><span className="tiny muted">{ASPECT_USE[a]}</span>
          </button>
        );
      })}
    </div>
  );
}

export const Swatches = ({ colors }: { colors: Record<string, string> }) => (
  <div className="swatches">{["primary", "accent", "dark", "light"].map((k) => <i key={k} style={{ background: colors[k] }} />)}</div>
);

export function FilePick({ accept, onFile, children, className }: { accept: string; onFile(f: File): void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={className} onClick={() => ref.current?.click()} role="button">
      {children}
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </div>
  );
}

export const Spinner = () => <span className="spin" />;

/* ---------- fonts ---------- */
const faces = new Map<string, Promise<string>>();
/** Load a font file once and return a CSS family name for it ("" until loaded / on failure). */
export function useFontFace(url?: string) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!url) { setName(""); return; }
    if (!faces.has(url)) {
      const fam = `ff-${faces.size}`;
      faces.set(url, new FontFace(fam, `url(${url})`).load().then((f) => { document.fonts.add(f); return fam; }).catch(() => ""));
    }
    let live = true;
    faces.get(url)!.then((n) => live && setName(n));
    return () => { live = false; };
  }, [url]);
  return name;
}
export const fam = (n: string, fb = "sans-serif") => (n ? `"${n}", ${fb}` : fb);

/* ---------- colour ---------- */
const hx = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const mixHex = (a: string, b: string, t: number) => { const x = hx(a), y = hx(b); return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase(); };
const lum = (h: string) => { const [r, g, b] = hx(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const onHex = (bg: string) => (lum(bg) > 0.4 ? "#0E1116" : "#FFFFFF");

/** Brand colours from a logo: the most common saturated hue is primary, the next distinct hue is accent. */
export async function paletteFromImage(url: string): Promise<Base | null> {
  const img = new Image(); img.src = url;
  await img.decode().catch(() => null);
  if (!img.naturalWidth) return null;
  const c = document.createElement("canvas"); c.width = c.height = 72;
  const g = c.getContext("2d")!; g.drawImage(img, 0, 0, 72, 72);
  const d = g.getImageData(0, 0, 72, 72).data;
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (mx - mn < 40 || mx < 40) continue;   // greys, white, black
    const h = mx === r ? ((gg - b) / (mx - mn) + 6) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4;
    const k = Math.round(h * 4) % 24;
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }; e.n++; e.r += r; e.g += gg; e.b += b; bins.set(k, e);
  }
  const top = [...bins.entries()].sort((a, b) => b[1].n - a[1].n);
  if (!top.length) return null;
  const hex = (e: { n: number; r: number; g: number; b: number }) => "#" + [e.r, e.g, e.b].map((v) => Math.round(v / e.n).toString(16).padStart(2, "0")).join("").toUpperCase();
  const primary = hex(top[0][1]);
  const second = top.find(([k]) => Math.min(Math.abs(k - top[0][0]), 24 - Math.abs(k - top[0][0])) >= 3);
  const accent = second ? hex(second[1]) : mixHex(primary, "#FFFFFF", 0.35);
  return { primary, accent, dark: mixHex(primary, "#05060A", 0.88), light: mixHex(primary, "#FFFFFF", 0.95), ink: mixHex(primary, "#05060A", 0.9) };
}

/* ---------- theme preview ---------- */
/** A small two-scene preview of a look: a dark title and a light card with a button. */
export function LookPreview({ colors, display, body, name, logoDark, compact }: {
  colors: Record<string, string>; display?: string; body?: string; name: string; logoDark?: string; compact?: boolean;
}) {
  const fd = useFontFace(display), fb = useFontFace(body);
  const c = colors;
  return (
    <div className={`look ${compact ? "compact" : ""}`}>
      <div className="look-dark" style={{ background: `radial-gradient(120% 90% at 80% 20%, ${c.primary}38, transparent 60%), ${c.dark}` }}>
        {logoDark ? <img src={logoDark} alt="" /> : <span className="k" style={{ color: c.primary400 ?? c.primary }}>Introducing</span>}
        <b style={{ fontFamily: fam(fd) }}>{name || "Your brand"}, <em style={{ color: "rgba(255,255,255,.42)" }}>made simple.</em></b>
      </div>
      <div className="look-light" style={{ background: c.light, color: c.ink }}>
        <div className="lc" style={{ fontFamily: fam(fb) }}><i style={{ background: c.primary50 ?? mixHex(c.primary, "#FFFFFF", 0.9), color: c.primary }} />
          <span><b style={{ fontFamily: fam(fd) }}>Fast setup</b><small>Ready in minutes</small></span></div>
        <span className="lb" style={{ background: c.primary, color: onHex(c.primary), fontFamily: fam(fd) }}>Get started →</span>
      </div>
    </div>
  );
}

export function ThemeGrid({ themes, value, onChange, name }: { themes: Theme[]; value: string; onChange(id: string): void; name: string }) {
  return (
    <div className="themes">
      {themes.map((t) => (
        <button key={t.id} type="button" className={`theme ${value === t.id ? "on" : ""}`} onClick={() => onChange(t.id)}>
          <LookPreview colors={t.colors} display={t.fontUrls.display} body={t.fontUrls.body} name={name} compact />
          <div className="tmeta"><b>{t.name}</b><span>{t.fontFamilies.display}</span>{value === t.id && <span className="tick">{Icon.check}</span>}</div>
        </button>
      ))}
    </div>
  );
}
