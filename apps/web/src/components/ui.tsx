import { useRef, type ReactNode } from "react";
import { ASPECT_NAME, ASPECT_USE, type BrandKit } from "../api.ts";

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

export function BrandPicker({ brands, value, onChange }: { brands: BrandKit[]; value: string; onChange(id: string): void }) {
  return (
    <div className="brand-pick">
      {brands.map((b) => (
        <button key={b.id} type="button" className={`toggle-card ${value === b.id ? "on" : ""}`} onClick={() => onChange(b.id)}>
          {b.urls.logoOnLight ? <img src={b.urls.logoOnLight} alt="" /> : <b>{b.name}</b>}
          <div className="row" style={{ justifyContent: "space-between" }}><span className="small" style={{ fontWeight: 600 }}>{b.name}</span><Swatches kit={b} /></div>
        </button>
      ))}
      <a className="toggle-card" href="#/brands/new" style={{ display: "grid", placeItems: "center", color: "var(--accent)", fontWeight: 600 }}>+ New brand</a>
    </div>
  );
}

export const Swatches = ({ kit }: { kit: BrandKit }) => (
  <div className="swatches">{["primary", "accent", "dark", "light"].map((k) => <i key={k} style={{ background: kit.colors[k] }} />)}</div>
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
