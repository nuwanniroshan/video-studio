/*
 * Forms generated from scene JSON Schemas (zod `.meta({ ui, label, help, maxChars })`, PLAN §5.3).
 * Handles text/richText, number, toggle, select, objects, lists, discriminated unions (kind),
 * assets (upload or pick) and hotspots/focus rects drawn on the screenshot.
 */
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { api, fileUrl, type Json } from "../api.ts";

export interface FormCtx { project: string; assets: string[]; onAssetsChanged(): void }

const label = (s: Json, key: string) => s?.label ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c: string) => c.toUpperCase());

/** A sensible empty value for a schema (used when adding list items or switching union kinds). */
export function blank(s: Json): Json {
  if (!s) return undefined;
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.oneOf) return blank(s.oneOf[0]);
  if (s.anyOf) return blank(s.anyOf.find((x: Json) => x.type !== "null") ?? s.anyOf[0]);
  switch (s.type) {
    case "string": return s.ui === "asset" ? "" : "New text";
    case "number": case "integer": return s.minimum ?? 0;
    case "boolean": return false;
    case "array": return Array.from({ length: s.minItems ?? 0 }, () => blank(s.items));
    case "object": return Object.fromEntries((s.required ?? []).map((k: string) => [k, blank(s.properties[k])]));
  }
  return undefined;
}

export function SchemaForm({ schema, value, onChange, ctx, path = "" }: { schema: Json; value: Json; onChange(v: Json): void; ctx: FormCtx; path?: string }) {
  const props = schema.properties ?? {};
  const req = new Set<string>(schema.required ?? []);
  return (
    <div className="fields">
      {Object.entries(props).map(([k, s]) => k === "kind" ? null : (
        <Field key={k} name={k} schema={s as Json} value={value?.[k]} required={req.has(k)} siblings={value} ctx={ctx} path={path ? `${path}.${k}` : k}
          onChange={(v) => onChange({ ...value, [k]: v })} />
      ))}
    </div>
  );
}

function Field({ name, schema: s, value, onChange, required, siblings, ctx, path }: {
  name: string; schema: Json; value: Json; onChange(v: Json): void; required: boolean; siblings: Json; ctx: FormCtx; path: string;
}) {
  const lab = label(s, name);
  const opt = !required && s.default === undefined;
  const toggleOpt = opt && value === undefined
    ? <button className="link" onClick={() => onChange(blank(s))}>+ Add {lab.toLowerCase()}</button>
    : null;
  if (toggleOpt) return <div className="field optional">{toggleOpt}</div>;
  const remove = opt ? <button className="link small" title="Remove" onClick={() => onChange(undefined)}>remove</button> : null;
  const head = (extra?: ReactNode) => <div className="flabel"><span>{lab}</span>{extra}{remove}</div>;

  if (s.oneOf) {
    const kinds = s.oneOf.map((o: Json) => o.properties?.kind?.const);
    const idx = Math.max(0, kinds.indexOf(value?.kind));
    return (
      <fieldset className="field group">
        <legend>{lab}</legend>
        <div className="seg">{kinds.map((k: string, i: number) => (
          <button key={k} className={i === idx ? "on" : ""} onClick={() => i !== idx && onChange(blank(s.oneOf[i]))}>{k}</button>
        ))}</div>
        <SchemaForm schema={s.oneOf[idx]} value={value} onChange={onChange} ctx={ctx} path={path} />
      </fieldset>
    );
  }
  if (s.ui === "asset") return <div className="field">{head()}<AssetField value={value} onChange={onChange} ctx={ctx} /></div>;
  if (s.ui === "hotspots" || s.ui === "focusRect") {
    const screen = siblings?.screen as string | undefined;
    return <div className="field">{head()}<SpotField kind={s.ui} value={value} onChange={onChange} screen={screen} ctx={ctx} help={s.help} /></div>;
  }
  if (s.enum) {
    return <div className="field">{head()}<select value={value ?? s.default} onChange={(e) => onChange(e.target.value)}>{s.enum.map((o: string) => <option key={o}>{o}</option>)}</select>{s.help && <p className="help">{s.help}</p>}</div>;
  }
  switch (s.type) {
    case "string": {
      const v = value ?? "";
      const long = (s.maxChars ?? 0) > 70;
      const over = s.maxChars && v.replace(/\*/g, "").length > s.maxChars;
      const counter = s.maxChars ? <span className={`count ${over ? "over" : ""}`}>{v.replace(/\*/g, "").length}/{s.maxChars}</span> : null;
      return (
        <div className="field">
          {head(counter)}
          {long ? <textarea rows={3} value={v} onChange={(e) => onChange(e.target.value)} /> : <input value={v} onChange={(e) => onChange(e.target.value)} />}
          {s.help && <p className="help">{s.help}</p>}
        </div>
      );
    }
    case "number": case "integer":
      return <div className="field">{head()}<input type="number" step={s.type === "integer" ? 1 : "any"} value={value ?? ""} min={s.minimum} max={s.maximum}
        onChange={(e) => onChange(e.target.value === "" ? undefined : +e.target.value)} />{s.help && <p className="help">{s.help}</p>}</div>;
    case "boolean":
      return <label className="field check"><input type="checkbox" checked={!!(value ?? s.default)} onChange={(e) => onChange(e.target.checked)} /> {lab}</label>;
    case "object":
      return <fieldset className="field group"><legend>{lab}{remove}</legend><SchemaForm schema={s} value={value ?? {}} onChange={onChange} ctx={ctx} path={path} /></fieldset>;
    case "array": {
      const arr: Json[] = value ?? [];
      const max = s.maxItems ?? 99, min = s.minItems ?? 0;
      const itemLabel = label(s.items, "item");
      return (
        <fieldset className="field group">
          <legend>{lab} <span className="muted">({arr.length}/{max})</span>{remove}</legend>
          {arr.map((it, i) => (
            <div className="item" key={i}>
              <div className="item-bar">
                <span className="muted">{itemLabel} {i + 1}</span>
                <span>
                  <button className="link small" disabled={i === 0} onClick={() => { const a = [...arr]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }}>↑</button>
                  <button className="link small" disabled={i === arr.length - 1} onClick={() => { const a = [...arr]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; onChange(a); }}>↓</button>
                  <button className="link small danger" disabled={arr.length <= min} onClick={() => onChange(arr.filter((_, j) => j !== i))}>✕</button>
                </span>
              </div>
              {s.items.type === "object" || s.items.oneOf
                ? <Field name={itemLabel} schema={{ ...s.items, label: "" }} value={it} required siblings={arr} ctx={ctx} path={`${path}.${i}`}
                    onChange={(v) => onChange(arr.map((x, j) => (j === i ? v : x)))} />
                : <Field name="" schema={{ ...s.items, label: " " }} value={it} required siblings={arr} ctx={ctx} path={`${path}.${i}`}
                    onChange={(v) => onChange(arr.map((x, j) => (j === i ? v : x)))} />}
            </div>
          ))}
          {arr.length < max && <button className="link" onClick={() => onChange([...arr, blank(s.items)])}>+ Add {itemLabel.toLowerCase()}</button>}
        </fieldset>
      );
    }
  }
  return null;
}

function AssetField({ value, onChange, ctx }: { value?: string; onChange(v: string): void; ctx: FormCtx }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try { const r = await api.uploadAsset(ctx.project, f); ctx.onAssetsChanged(); onChange(r.path); } finally { setBusy(false); }
  };
  return (
    <div className="asset">
      {value ? <img src={fileUrl(ctx.project, value)} alt="" /> : <div className="noimg">No image</div>}
      <div className="asset-ctl">
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Choose an image…</option>
          {ctx.assets.map((a) => <option key={a} value={a}>{a.replace(/^assets\//, "")}</option>)}
        </select>
        <button onClick={() => ref.current?.click()} disabled={busy}>{busy ? "Uploading…" : "Upload…"}</button>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </div>
  );
}

/** Click on the screenshot to set a point; for a focus rect, click two opposite corners. */
function SpotField({ kind, value, onChange, screen, ctx, help }: { kind: string; value?: Json; onChange(v: Json): void; screen?: string; ctx: FormCtx; help?: string }) {
  const [corner, setCorner] = useState<{ x: number; y: number } | null>(null);
  if (!screen) return <p className="help">Choose a screenshot first.</p>;
  const pos = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: +((e.clientX - r.left) / r.width).toFixed(3), y: +((e.clientY - r.top) / r.height).toFixed(3) };
  };
  const click = (e: MouseEvent) => {
    const p = pos(e);
    if (kind === "hotspots") return onChange(p);
    if (!corner) return setCorner(p);
    const x = Math.min(corner.x, p.x), y = Math.min(corner.y, p.y);
    onChange({ x, y, w: Math.max(0.05, Math.abs(p.x - corner.x)), h: Math.max(0.05, Math.abs(p.y - corner.y)) });
    setCorner(null);
  };
  return (
    <div>
      <div className="spot" onClick={click}>
        <img src={fileUrl(ctx.project, screen)} alt="" draggable={false} />
        {kind === "hotspots" && value && <i className="dot" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }} />}
        {kind === "focusRect" && value && <i className="rect" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.w * 100}%`, height: `${value.h * 100}%` }} />}
        {corner && <i className="dot pending" style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }} />}
      </div>
      <p className="help">{kind === "hotspots" ? "Click where the cursor should click." : corner ? "Now click the opposite corner." : (help ?? "Click two corners of the area to zoom to on phones.")}</p>
    </div>
  );
}
