/*
 * Deterministic, seekable motion engine (TypeScript port of the prototype's src/engine.js).
 *
 * Every visual property is a pure function of time, so any frame can be rendered in any
 * order (parallel capture, sub-frame motion blur). Differences from the prototype, each
 * fixing a pitfall recorded in docs/REFERENCE.md §2:
 *
 *  1. A `from: null` segment that starts while the previous one is still running continues
 *     from the previous segment's *live* value at its start time, not from its end target.
 *  2. `initial(target, vals)` declares the value a channel has before its first segment.
 *  3. `fn` key groups have one rule: the latest-started member runs; before any member has
 *     started, the earliest one runs.
 *  4. `from()` throws for props with no rest default (pct, w, h, dash, clip*).
 *  9. Segments are binary-searched and only channels of elements touched by an active
 *     scope are evaluated.
 *
 * Instances are created with `createTimeline()`; `tl.scope(offset, {id, start, end})` gives
 * scenes a local clock starting at 0, a seeded RNG and an activity range.
 */
import { clamp, ease, lerp, toEase, type Ease, type EaseLike } from "./ease.ts";
import { hashSeed, rand } from "./rand.ts";

export type Prop =
  | "x" | "y" | "z" | "s" | "sx" | "sy" | "r" | "rx" | "ry"
  | "o" | "blur" | "bright" | "sat"
  | "w" | "h" | "pct" | "dash" | "clipX" | "clipY" | "clipR";
export type Vals = Partial<Record<Prop, number>>;
export type Target = Element | Element[] | NodeListOf<Element> | string | null | undefined;

export const DEFAULTS: Partial<Record<Prop, number>> = {
  x: 0, y: 0, z: 0, s: 1, sx: 1, sy: 1, r: 0, rx: 0, ry: 0, o: 1, blur: 0, bright: 1, sat: 1,
};
const TRANSFORM = new Set<Prop>(["x", "y", "z", "s", "sx", "sy", "r", "rx", "ry"]);
const FILTER = new Set<Prop>(["blur", "bright", "sat"]);
const PROPS = new Set<string>([...TRANSFORM, ...FILTER, "o", "w", "h", "pct", "dash", "clipX", "clipY", "clipR"]);

interface Seg { t0: number; d: number; a: number | null; b: number; e: Ease; }
interface Channel {
  el: Element; prop: Prop; segs: Seg[]; initial?: number; resolved: boolean;
}
interface FnRec {
  t0: number; d: number; cb: (p: number, t: number) => void; e: Ease; key: string | null;
  scope: ScopeState; continuous: boolean;
}
interface Win { el: HTMLElement | SVGElement; a: number; b: number; }
interface ScopeState { id: string; offset: number; start: number; end: number; els: Set<Element>; fns: FnRec[]; }
interface ElState { channels: Map<Prop, Channel>; last: Record<string, string>; }

export interface Marker { kind: string; t: number; scope: string; data?: unknown; }
export interface FnOptions { ease?: EaseLike; key?: string; continuous?: boolean; }
export interface ScopeOptions { id?: string; start?: number; end?: number; root?: ParentNode; }

class Engine {
  els = new Map<Element, ElState>();
  scopes: ScopeState[] = [];
  windows: Win[] = [];
  markers: Marker[] = [];
  warnings: string[] = [];
  time = NaN;

  channel(el: Element, prop: Prop): Channel {
    let st = this.els.get(el);
    if (!st) this.els.set(el, (st = { channels: new Map(), last: {} }));
    let ch = st.channels.get(prop);
    if (!ch) st.channels.set(prop, (ch = { el, prop, segs: [], resolved: false }));
    return ch;
  }

  /** Sort segments and resolve `null` starts (live-value continuation, pitfall 1). */
  resolve(ch: Channel) {
    if (ch.resolved) return;
    const segs = ch.segs;
    segs.sort((x, y) => x.t0 - y.t0);
    let prev: Seg | null = null;
    let base = ch.initial ?? DEFAULTS[ch.prop] ?? 0;
    for (const s of segs) {
      if (s.a === null) {
        if (!prev) s.a = base;
        else if (s.t0 < prev.t0 + prev.d) s.a = lerp(prev.a as number, prev.b, prev.e(clamp((s.t0 - prev.t0) / prev.d)));
        else s.a = prev.b;
      } else if (prev && s.t0 < prev.t0 + prev.d - 1e-9) {
        this.warnings.push(`overlapping explicit-from segment on ${describe(ch.el)}.${ch.prop} at ${s.t0.toFixed(3)}s`);
      }
      prev = s;
    }
    ch.resolved = true;
  }

  valueAt(ch: Channel, t: number): number {
    this.resolve(ch);
    const segs = ch.segs;
    if (!segs.length) return ch.initial ?? DEFAULTS[ch.prop] ?? 0;
    if (t < segs[0].t0) return ch.initial ?? (segs[0].a as number);
    // binary search: last segment with t0 <= t
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].t0 <= t) lo = mid; else hi = mid - 1;
    }
    const s = segs[lo];
    return lerp(s.a as number, s.b, s.e(clamp((t - s.t0) / s.d)));
  }

  active(t: number) {
    return this.scopes.filter((s) => t >= s.start && t < s.end);
  }

  seek(t: number) {
    this.time = t;
    // Windows toggle visibility only: display:none zeroed rects (pitfall 6) and discards layout
    // state on every scene change. Byte-exact determinism comes from the renderer reloading the
    // page at each segment start, not from here (SPIKE.md §Determinism).
    for (const w of this.windows) {
      const vis = t >= w.a && t < w.b ? "visible" : "hidden";
      if (w.el.style.visibility !== vis) w.el.style.visibility = vis;
    }
    const scopes = this.active(t);
    const touched = new Set<Element>();
    for (const s of scopes) for (const el of s.els) touched.add(el);
    for (const el of touched) this.apply(el, this.els.get(el)!, t);

    const keyed = new Map<string, FnRec>();
    for (const s of scopes) {
      for (const f of s.fns) {
        if (!f.key) { f.cb(f.e(clamp((t - f.t0) / f.d)), t - f.scope.offset); continue; }
        const cur = keyed.get(f.key);
        if (!cur) { keyed.set(f.key, f); continue; }
        const fStarted = f.t0 <= t, curStarted = cur.t0 <= t;
        if (fStarted && (!curStarted || f.t0 >= cur.t0)) keyed.set(f.key, f);
        else if (!fStarted && !curStarted && f.t0 < cur.t0) keyed.set(f.key, f);
      }
    }
    for (const f of keyed.values()) f.cb(f.e(clamp((t - f.t0) / f.d)), t - f.scope.offset);
  }

  apply(el: Element, st: ElState, t: number) {
    const v: Vals = {};
    let hasT = false, hasF = false;
    for (const [p, ch] of st.channels) {
      v[p] = this.valueAt(ch, t);
      if (TRANSFORM.has(p)) hasT = true;
      else if (FILTER.has(p)) hasF = true;
    }
    const style = (el as HTMLElement).style;
    const put = (k: string, val: string) => {
      if (st.last[k] !== val) { st.last[k] = val; style.setProperty(k, val); }
    };
    if (hasT) {
      const g = (p: Prop) => (v[p] ?? DEFAULTS[p]) as number;
      const s = g("s");
      // 2D transforms unless 3D is in use: translate3d promotes every animated word to its own
      // composited layer, which measured ~6% slower on SwiftShader (SPIKE.md).
      const is3d = Math.abs(g("z")) > 1e-4 || Math.abs(g("rx")) > 1e-4 || Math.abs(g("ry")) > 1e-4;
      put("transform", is3d
        ? `translate3d(${g("x").toFixed(2)}px,${g("y").toFixed(2)}px,${g("z").toFixed(2)}px)` +
          ` rotateX(${g("rx").toFixed(3)}deg) rotateY(${g("ry").toFixed(3)}deg) rotate(${g("r").toFixed(3)}deg)` +
          ` scale(${(s * g("sx")).toFixed(4)},${(s * g("sy")).toFixed(4)})`
        : `translate(${g("x").toFixed(2)}px,${g("y").toFixed(2)}px) rotate(${g("r").toFixed(3)}deg)` +
          ` scale(${(s * g("sx")).toFixed(4)},${(s * g("sy")).toFixed(4)})`);
    }
    if (v.o !== undefined) put("opacity", clamp(v.o).toFixed(4));
    if (hasF) {
      // Keep the same filter-function list for the channel's whole life (blur(0px) rather than
      // "none"): toggling a filter on and off changes render-surface promotion, and the resulting
      // raster then depends on seek history (SPIKE.md, determinism).
      const parts: string[] = [];
      if (v.blur !== undefined && v.blur > 0.01) parts.push(`blur(${v.blur.toFixed(2)}px)`);
      if (v.bright !== undefined && Math.abs(v.bright - 1) > 0.001) parts.push(`brightness(${v.bright.toFixed(3)})`);
      if (v.sat !== undefined && Math.abs(v.sat - 1) > 0.001) parts.push(`saturate(${v.sat.toFixed(3)})`);
      put("filter", parts.join(" ") || "none");
    }
    if (v.w !== undefined) put("width", v.w.toFixed(2) + "px");
    if (v.h !== undefined) put("height", v.h.toFixed(2) + "px");
    if (v.pct !== undefined) put("width", v.pct.toFixed(3) + "%");
    if (v.dash !== undefined) put("stroke-dashoffset", (1 - v.dash).toFixed(4));
    // fully open clips write "none" so a finished wipe/iris costs nothing for the rest of the scene
    if (v.clipX !== undefined) put("clip-path", v.clipX >= 100 ? "none" : `inset(0 ${(100 - v.clipX).toFixed(3)}% 0 0)`);
    if (v.clipY !== undefined) put("clip-path", v.clipY >= 100 ? "none" : `inset(${(100 - v.clipY).toFixed(3)}% 0 0 0)`);
    if (v.clipR !== undefined) put("clip-path", v.clipR >= 142 ? "none" : `circle(${v.clipR.toFixed(3)}% at var(--cx,50%) var(--cy,50%))`);
  }

  /** True if anything visible may change between t0 and t1 (inclusive), across all scopes. */
  activity(t0: number, t1 = t0): boolean {
    for (const w of this.windows) if ((w.a > t0 && w.a <= t1) || (w.b > t0 && w.b <= t1)) return true;
    for (const st of this.els.values()) {
      for (const ch of st.channels.values()) {
        this.resolve(ch);
        for (const s of ch.segs) {
          if (s.a === s.b) continue;
          if (s.t0 + s.d > t0 && s.t0 <= t1) return true;
        }
      }
    }
    for (const sc of this.scopes) {
      if (sc.end <= t0 || sc.start > t1) continue;
      for (const f of sc.fns) {
        if (f.continuous) return true;
        if (f.t0 + f.d > t0 && f.t0 <= t1) return true;
      }
    }
    return false;
  }
}

function describe(el: Element) {
  return el.id ? `#${el.id}` : el.className ? `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}` : el.tagName.toLowerCase();
}

export class Scope {
  /** @internal */ readonly _e: Engine;
  /** @internal */ readonly _s: ScopeState;
  readonly root: ParentNode | undefined;
  readonly ease = ease;
  /** Seeded RNG, stable per scope id. */
  readonly random: () => number;

  /** @internal */
  constructor(e: Engine, s: ScopeState, root?: ParentNode) {
    this._e = e;
    this._s = s;
    this.root = root;
    this.random = rand(hashSeed(s.id));
  }

  get id() { return this._s.id; }
  get offset() { return this._s.offset; }

  /** A child scope whose local t=0 is `offset` local seconds into this one. */
  scope(offset: number, opt: ScopeOptions = {}): Scope {
    const abs = this._s.offset + offset;
    const st: ScopeState = {
      id: opt.id ?? `${this._s.id}/${offset}`,
      offset: abs,
      start: opt.start ?? -Infinity,
      end: opt.end ?? Infinity,
      els: new Set(),
      fns: [],
    };
    this._e.scopes.push(st);
    return new Scope(this._e, st, opt.root ?? this.root);
  }

  $(q: string | Element): Element | null {
    if (typeof q !== "string") return q;
    return (this.root ?? document).querySelector(q);
  }
  $$(q: Target): Element[] {
    if (q == null) return [];
    if (typeof q === "string") return [...(this.root ?? document).querySelectorAll(q)];
    if (Array.isArray(q)) return q;
    if (q instanceof Element) return [q];
    return [...(q as NodeListOf<Element>)];
  }

  private els(target: Target, what: string): Element[] {
    const els = this.$$(target).filter(Boolean);
    if (!els.length) throw new Error(`${what}: no element for ${String(target)}`);
    return els;
  }

  /** Animate `to` from `from` (or, where `from` is null or lacks a prop, from the channel's live value). */
  tw(target: Target, t0: number, d: number, from: Vals | null, to: Vals, e?: EaseLike): this {
    const E = toEase(e);
    for (const el of this.els(target, "tw")) {
      this._s.els.add(el);
      for (const p of Object.keys(to) as Prop[]) {
        if (!PROPS.has(p)) throw new Error(`tw: unknown prop "${p}"`);
        const ch = this._e.channel(el, p);
        ch.segs.push({ t0: this._s.offset + t0, d: Math.max(d, 1e-4), a: from && p in from ? from[p]! : null, b: to[p]!, e: E });
        ch.resolved = false;
      }
    }
    return this;
  }

  /** Animate from offset values to the rest defaults. */
  from(target: Target, t0: number, d: number, fromVals: Vals, e?: EaseLike): this {
    const to: Vals = {};
    for (const p of Object.keys(fromVals) as Prop[]) {
      const def = DEFAULTS[p];
      if (def === undefined) throw new Error(`from: "${p}" has no rest default; use tw() with explicit values`);
      to[p] = def;
    }
    return this.tw(target, t0, d, fromVals, to, e);
  }

  to(target: Target, t0: number, d: number, to: Vals, e?: EaseLike): this {
    return this.tw(target, t0, d, null, to, e);
  }

  set(target: Target, t0: number, vals: Vals): this {
    return this.tw(target, t0, 0.0001, null, vals, ease.linear);
  }

  /** Value a channel holds before its first segment (pitfall 2). */
  initial(target: Target, vals: Vals): this {
    for (const el of this.els(target, "initial")) {
      this._s.els.add(el);
      for (const p of Object.keys(vals) as Prop[]) {
        const ch = this._e.channel(el, p);
        ch.initial = vals[p];
        ch.resolved = false;
      }
    }
    return this;
  }

  hide(target: Target): this { return this.initial(target, { o: 0 }); }

  stagger(targets: Target, t0: number, gap: number, d: number, fromVals: Vals, e?: EaseLike): this {
    this.$$(targets).forEach((el, i) => this.from(el, t0 + i * gap, d, fromVals, e));
    return this;
  }

  /** Per-frame callback receiving eased progress (clamped 0..1) and this scope's local time. */
  fn(t0: number, d: number, cb: (p: number, t: number) => void, opt: FnOptions | EaseLike = {}): this {
    const o: FnOptions = typeof opt === "object" ? opt : { ease: opt };
    this._s.fns.push({
      t0: this._s.offset + t0, d: Math.max(d, 1e-4), cb, e: toEase(o.ease), key: o.key ?? null,
      scope: this._s, continuous: !!o.continuous,
    });
    return this;
  }

  /** Deterministic switch at local time t (pitfall 8). */
  at(t: number, on: () => void, off?: () => void): this {
    return this.fn(t, 0.0001, (p) => (p >= 1 ? on() : off?.()), { ease: ease.linear });
  }

  /** Element is displayed only within [a, b) local time. */
  window(target: Target, a: number, b: number): this {
    for (const el of this.$$(target)) this._e.windows.push({ el: el as HTMLElement, a: this._s.offset + a, b: this._s.offset + b });
    return this;
  }

  /** Record a marker (e.g. an SFX cue) at local time t. */
  emit(kind: string, t: number, data?: unknown): this {
    this._e.markers.push({ kind, t: this._s.offset + t, scope: this._s.id, data });
    return this;
  }

  /* ---------- text ---------- */

  /** Split an element's text into word spans, keeping inline tags intact (pitfall 7). */
  words(target: Target): HTMLElement[] {
    const el = this.els(target, "words")[0] as HTMLElement;
    if (!el.querySelector(".wi")) {
      const tokens = el.innerHTML.trim().split(/(\s+|<[^>]+>)/).filter((x) => x !== "");
      let out = "";
      for (const tk of tokens) {
        if (/^\s+$/.test(tk)) out += " ";
        else if (/^<[^>]+>$/.test(tk)) out += tk;
        else out += `<span class="w"><span class="wi">${tk}</span></span>`;
      }
      el.innerHTML = out;
    }
    return [...el.querySelectorAll<HTMLElement>(".wi")];
  }

  revealWords(target: Target, t0: number, gap = 0.06, d = 0.9, dist = 40, blur = 8): HTMLElement[] {
    const ws = this.words(target);
    ws.forEach((w, i) => this.from(w, t0 + i * gap, d, { y: dist, o: 0, blur }));
    return ws;
  }

  hideWords(target: Target, t0: number, gap = 0.03, d = 0.5): this {
    const el = this.els(target, "hideWords")[0];
    [...el.querySelectorAll(".wi")].forEach((w, i) => this.to(w, t0 + i * gap, d, { y: -24, o: 0, blur: 6 }, ease.in));
    return this;
  }

  type(target: Target, t0: number, d: number, text: string, caret = true): this {
    const el = this.els(target, "type")[0] as HTMLElement;
    el.textContent = "";
    let last = "";
    return this.fn(t0, d, (p, t) => {
      const n = Math.round(p * text.length);
      const blink = caret && (p < 1 ? true : Math.floor((t - t0 - d) * 2.4) % 2 === 0 && t - t0 - d < 1.2);
      const html = escapeHtml(text.slice(0, n)) + (blink && t >= t0 ? '<i class="caret"></i>' : "");
      if (html !== last) { el.innerHTML = html; last = html; }
    }, { ease: ease.linear });
  }

  count(target: Target, t0: number, d: number, a: number, b: number,
    fmt: (v: number) => string = (v) => Math.round(v).toString(), e?: EaseLike): this {
    const el = this.els(target, "count")[0];
    return this.fn(t0, d, (p) => { const s = fmt(lerp(a, b, p)); if (el.textContent !== s) el.textContent = s; }, { ease: e });
  }
}

export class Timeline extends Scope {
  constructor() {
    const e = new Engine();
    const st: ScopeState = { id: "root", offset: 0, start: -Infinity, end: Infinity, els: new Set(), fns: [] };
    e.scopes.push(st);
    super(e, st);
  }
  seek(t: number) { this._e.seek(t); }
  get time() { return this._e.time; }
  /** Markers sorted by time. */
  markers(): Marker[] { return [...this._e.markers].sort((a, b) => a.t - b.t); }
  activity(t0: number, t1 = t0) { return this._e.activity(t0, t1); }
  warnings(): string[] {
    for (const st of this._e.els.values()) for (const ch of st.channels.values()) this._e.resolve(ch);
    return [...this._e.warnings];
  }
  /** Seconds each element spends with `prop` above `threshold` (sampled at 1/30 s). Used by layout lint. */
  sustained(prop: Prop, threshold: number): { el: Element; seconds: number }[] {
    const out: { el: Element; seconds: number }[] = [];
    for (const [el, st] of this._e.els) {
      const ch = st.channels.get(prop);
      if (!ch || !ch.segs.length) continue;
      this._e.resolve(ch);
      const a = ch.segs[0].t0, b = Math.max(...ch.segs.map((s) => s.t0 + s.d));
      let n = 0;
      for (let t = a; t <= b; t += 1 / 30) if (this._e.valueAt(ch, t) > threshold) n++;
      const tail = this._e.valueAt(ch, b) > threshold ? Infinity : 0;
      if (n || tail) out.push({ el, seconds: tail || n / 30 });
    }
    return out;
  }

  /** Value a prop will have at time t (for tests and measurement). */
  valueAt(el: Element, prop: Prop, t: number): number {
    return this._e.valueAt(this._e.channel(el, prop), t);
  }
}

export const createTimeline = () => new Timeline();
export type ScopedTimeline = Scope;

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}
