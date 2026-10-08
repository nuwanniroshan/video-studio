/*
 * compose: free-form layers on a % grid of the safe frame, each with an entrance at a scene cue,
 * optional idle motion and an exit cue. Every motion is a pure function of time (seekable, deterministic).
 * Layer DOM: .cl (position, anchor, rotation) > .cl-mv (idle motion) > .cl-in (entrance/exit).
 */
import type { z } from "zod";
import type { Scope } from "@vs/engine";
import { SVG_TAGS, type compose as def } from "@vs/spec";
import type { AnimCtx, MountCtx } from "./types.ts";
import { animateBackground, background, browserFrame, exitTime, startTime, unit } from "./parts.ts";
import { h, plain, richText } from "./text.ts";
import { iconSvg } from "./icons.ts";
import type { SceneModule } from "./types.ts";

type P = z.output<typeof def.schema>;
type L = P["layers"][number];
type Text = Extract<L, { kind: "text" }>;
type Counter = Extract<L, { kind: "counter" }>;

const TOKENS: Record<string, string> = {
  primary: "var(--vs-primary)", "primary-light": "var(--vs-primary400)", "primary-dark": "var(--vs-primary700)",
  "primary-soft": "var(--vs-primary100)", accent: "var(--vs-accent)", "accent-soft": "var(--vs-accent50)", ink: "var(--vs-ink)",
  dark: "var(--vs-dark)", light: "var(--vs-light)", muted: "var(--vs-grey600)", white: "#FFFFFF", black: "#000000",
};
/** CSS colour for a token or hex; undefined for "auto" (the tone-aware CSS default applies). */
export const color = (c?: string) => (!c || c === "auto" ? undefined : TOKENS[c] ?? c);

/** Base font size per text style, in % of the stage's short side. */
const SIZE: Record<string, number> = { display: 12, headline: 7.4, title: 4.6, body: 2.4, label: 1.7, quote: 5.2, stat: 16 };
const TEXT_W: Record<string, number> = { display: 90, headline: 80, title: 70, body: 60, label: 60, quote: 80, stat: 50 };
const DEFAULT_W: Record<string, number> = { shape: 20, svg: 20, image: 40, icon: 6, particles: 30, logo: 30 };
const AX: Record<string, [number, number]> = {
  center: [-50, -50], "top-left": [0, 0], top: [-50, 0], "top-right": [-100, 0], left: [0, -50], right: [-100, -50],
  "bottom-left": [0, -100], bottom: [-50, -100], "bottom-right": [-100, -100],
};

function placement(l: L, ctx: { orient: string }) {
  const o = (ctx.orient === "portrait" ? l.portrait : ctx.orient === "square" ? l.square : undefined) ?? {};
  const size = "size" in l ? (l.size as number) : 1;
  const align = "align" in l ? (l.align as string) : "center";
  return { x: o.x ?? l.x, y: o.y ?? l.y, w: o.w ?? l.w, h: o.h ?? l.h, anchor: o.anchor ?? l.anchor, size: o.size ?? size, align: o.align ?? align };
}

/** Keep only allowlisted SVG elements and attributes (the spec validator already rejects the rest). */
function cleanSvg(markup: string): SVGSVGElement | null {
  const src = /<svg[^>]*\sxmlns=/.test(markup) ? markup : markup.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  const doc = new DOMParser().parseFromString(src, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return null;
  const walk = (el: Element) => {
    for (const c of [...el.children]) {
      if (!SVG_TAGS.has(c.nodeName.toLowerCase())) { c.remove(); continue; }
      walk(c);
    }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value;
      if (n.startsWith("on") || ((n === "href" || n === "xlink:href") && !v.startsWith("#")) || /url\(\s*["']?(?!#)|javascript:|data:/i.test(v)) el.removeAttribute(a.name);
    }
  };
  walk(svg);
  return document.importNode(svg, true) as unknown as SVGSVGElement;
}

const STROKED = "path,line,polyline,polygon,circle,ellipse,rect";

function textEl(l: Text | Counter, cls: string, html: string) {
  const el = h("div", `cl-text vs-text cm-s-${l.style} ${cls}`, html);
  if (l.kind === "text") {
    if (l.font !== "auto") el.style.fontFamily = `var(--vs-font-${l.font})`;
    if (l.weight !== "auto") el.style.fontWeight = l.weight;
    if (l.italic) el.style.fontStyle = "italic";
    if (l.caps) el.style.textTransform = "uppercase";
    if (l.tracking !== undefined) el.style.letterSpacing = `${l.tracking}em`;
    if (color(l.accent)) el.style.setProperty("--cm-accent", color(l.accent)!);
    if (l.deco !== "none") { el.classList.add(`cm-deco-${l.deco}`); el.style.setProperty("--cm-deco", color(l.decoColor) ?? "var(--vs-primary)"); }
  }
  if (color(l.color)) el.style.color = color(l.color)!;
  return el;
}
const fmtCount = (l: Counter) => (v: number) =>
  `${l.prefix ?? ""}${v.toLocaleString("en-US", { minimumFractionDigits: l.decimals, maximumFractionDigits: l.decimals })}${l.suffix ?? ""}`;

/** Is the background dark? Measured from its colours, so default text stays readable whatever tone the scene says. */
function isDark(root: HTMLElement, colors: string[] | null, tone: string): boolean {
  if (!colors) return tone !== "light";
  const probe = h("i", "");
  root.append(probe);
  const lum = colors.map((c) => {
    probe.style.color = c;
    const m = getComputedStyle(probe).color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
    const [r, g, b] = m.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });
  probe.remove();
  // weight the first colour (centre of radials, start of gradients) a little more
  const avg = lum.length > 1 ? (lum[0] * 0.6 + lum.slice(1).reduce((a, b) => a + b, 0) / (lum.length - 1) * 0.4) : lum[0];
  return avg < 0.3;
}

function background_(root: HTMLElement, p: P, ctx: MountCtx): boolean {
  const b = p.background;
  let dark = ctx.tone !== "light";
  if (b.style === "tone") background(root, ctx.tone);
  else {
    const defaults = ctx.tone === "light" ? ["light", "#FFFFFF"] : ctx.tone === "brand" ? ["primary-dark", "primary"] : ["dark", "primary-dark"];
    const c = (b.colors?.length ? b.colors : defaults).map((x) => color(x) ?? color(defaults[0])!);
    const c1 = c[1] ?? c[0];
    if (b.style !== "none") dark = isDark(root, b.style === "solid" ? [c[0]] : b.style === "spotlight" ? [c[0]] : c, ctx.tone);
    const css = {
      solid: c[0],
      linear: `linear-gradient(${b.angle}deg, ${c.join(", ")})`,
      radial: `radial-gradient(120% 95% at 50% 38%, ${c.join(", ")})`,
      spotlight: `radial-gradient(75cqmax 55cqmax at 50% -12%, color-mix(in srgb, ${c1} 60%, transparent), transparent 70%), ${c[0]}`,
      split: `linear-gradient(${b.angle}deg, ${c[0]} 50%, ${c1} 50%)`,
      none: "transparent",
    }[b.style];
    const bg = h("div", "bg cm-bg");
    bg.style.background = css;
    root.prepend(bg);
  }
  if (b.motif !== "none") {
    const m = h("div", `cm-motif cm-motif-${b.motif}`);
    m.style.color = color(b.motifColor) ?? (dark ? "#FFFFFF" : "var(--vs-ink)");
    m.style.opacity = String(b.motifOpacity * ({ grid: 0.12, dots: 0.3, lines: 0.12, rings: 0.12, waves: 0.25, grain: 0.55 }[b.motif] ?? 0.2));
    if (b.motif === "waves") m.innerHTML = `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">${Array.from({ length: 7 }, (_, i) =>
      `<path d="M-50 ${300 + i * 70} C 200 ${230 + i * 70}, 350 ${390 + i * 70}, 550 ${310 + i * 70} S 900 ${240 + i * 70}, 1050 ${320 + i * 70}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`).join("")}</svg>`;
    if (b.motif === "grain") m.innerHTML = `<svg width="100%" height="100%"><filter id="cm-grain-${ctx.id}"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#cm-grain-${ctx.id})"/></svg>`;
    root.querySelector(".bg")!.after(m);
  }
  if (b.vignette) root.querySelector(".cm-motif, .bg")!.after(h("div", "cm-vignette"));
  return dark;
}

function mountLayer(l: L, i: number, frame: HTMLElement, ctx: MountCtx, dark: boolean) {
  const pl = placement(l, ctx);
  const u = unit(ctx.stage);
  const short = Math.min(ctx.stage.w, ctx.stage.h) / 100;
  const outer = h("div", `cl cl-${l.kind}`);
  outer.dataset.layer = String(i);
  const mv = h("div", "cl-mv"), inn = h("div", "cl-in");
  mv.append(inn); outer.append(mv); frame.append(outer);
  const w = pl.w ?? (l.kind === "text" || l.kind === "counter" ? TEXT_W[l.style] : DEFAULT_W[l.kind]);
  const [ax, ay] = AX[pl.anchor];
  Object.assign(outer.style, { left: `${pl.x}%`, top: `${pl.y}%`, width: `${w}%`, transform: `translate(${ax}%, ${ay}%) rotate(${l.rotate}deg)`, opacity: String(l.opacity) });
  if (pl.h !== undefined) outer.style.height = `${pl.h}%`;
  const square = () => { if (pl.h === undefined) outer.style.aspectRatio = "1"; };

  switch (l.kind) {
    case "text": case "counter": {
      const el = l.kind === "text" ? textEl(l, "", richText(l.text)) : textEl(l, "cl-count", fmtCount(l)(l.value));
      el.style.textAlign = pl.align;
      inn.style.textAlign = pl.align;
      inn.append(el);
      const portraitBump = ctx.orient === "portrait" && (l.style === "body" || l.style === "label") ? 1.4 : 1;
      const max = SIZE[l.style] * pl.size * portraitBump * short;
      const fh = pl.h !== undefined ? (pl.h / 100) * outer.parentElement!.clientHeight : undefined;
      ctx.fitText(el, { min: Math.min(max, Math.max(14 * u, max * 0.4)), max, maxHeight: fh });
      if (l.kind === "counter") el.textContent = fmtCount(l)(l.from);
      if (l.kind === "text" && l.enter === "typewriter") { el.dataset.text = plain(l.text); el.style.minHeight = el.getBoundingClientRect().height + "px"; }
      break;
    }
    case "shape": {
      const s = h("div", `cm-shape cm-${l.shape}`);
      const fill = color(l.fill) ?? "var(--vs-primary)";
      const paint = l.fill2 ? `linear-gradient(${l.gradientAngle}deg, ${fill}, ${color(l.fill2)})` : fill;
      const sw = l.strokeWidth * u;
      if (l.shape === "line") { outer.style.height = pl.h !== undefined ? `${pl.h}%` : `${Math.max(1, sw)}px`; s.style.background = paint; }
      else if (l.shape === "ring") { square(); s.style.border = `${Math.max(1, sw)}px solid ${fill}`; }
      else if (l.shape === "arc") {
        square();
        s.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${50 - Math.min(20, l.strokeWidth / 2)}" style="fill:none;stroke:${fill};stroke-dasharray:0.7 2" stroke-width="${l.strokeWidth}" stroke-linecap="round" pathLength="1" transform="rotate(-90 50 50)"/></svg>`;
      } else {
        if (l.shape === "circle" || l.shape === "blob" || l.shape === "triangle") square();
        s.style.background = paint;
        if (l.shape === "rect") s.style.borderRadius = `${l.radius}%`;
      }
      if (l.stroke && l.shape !== "ring" && l.shape !== "arc" && l.shape !== "line") s.style.boxShadow = `inset 0 0 0 ${Math.max(1, sw)}px ${color(l.stroke)}`;
      if (l.shadow) s.style.filter = "drop-shadow(0 2.4cqmin 4cqmin rgba(0,0,0,.28))";
      inn.append(s);
      break;
    }
    case "svg": {
      const svg = cleanSvg(l.svg);
      if (!svg) break;
      svg.classList.add("cm-svg");
      inn.style.color = color(l.color) ?? "var(--vs-primary)";
      const vb = svg.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
      if (pl.h === undefined && vb?.length === 4 && vb[2] > 0 && vb[3] > 0) outer.style.aspectRatio = `${vb[2]} / ${vb[3]}`;
      else square();
      svg.removeAttribute("width"); svg.removeAttribute("height");
      inn.append(svg);
      break;
    }
    case "image": {
      const img = h("img", "cm-img");
      img.src = ctx.url(l.src);
      img.style.objectFit = l.fit;
      img.style.objectPosition = `${(l.focusX * 100).toFixed(1)}% ${(l.focusY * 100).toFixed(1)}%`;
      if (pl.h === undefined) outer.style.aspectRatio = l.frame === "circle" ? "1" : l.frame === "phone" ? "9 / 19" : l.frame === "polaroid" ? "0.86" : "16 / 10";
      const box = h("div", `cm-media cm-frame-${l.frame}`);
      if (l.frame === "browser") {
        const { frame: f, view } = browserFrame(ctx.brand.ctaUrl);
        view.append(img); box.append(f);
      } else box.append(img);
      inn.append(box);
      break;
    }
    case "icon": {
      square();
      const ic = h("div", `cm-icon${l.badge ? " badge" : ""}`, iconSvg(l.icon, "cm-ico"));
      ic.style.color = color(l.color) ?? "var(--vs-primary)";
      if (l.badge) ic.style.background = color(l.badge)!;
      inn.append(ic);
      break;
    }
    case "logo": {
      const onDark = l.version === "on-dark" || (l.version === "auto" && dark);
      const img = h("img", "cm-logo");
      img.src = onDark ? ctx.brand.logoOnDark : ctx.brand.logoOnLight;
      if (pl.h !== undefined) img.style.height = "100%";
      inn.append(img);
      break;
    }
    case "particles": {
      if (pl.h === undefined) square();
      const c1 = color(l.color) ?? (dark ? "#FFFFFF" : "var(--vs-primary)");
      const c2 = color(l.color2) ?? c1;
      for (let k = 0; k < l.count; k++) {
        const pt = h("i", `cm-pt cm-pt-${l.style}`);
        pt.style.setProperty("--c", k % 2 ? c2 : c1);
        inn.append(pt);
      }
      break;
    }
  }
}

/* ---------- motion ---------- */

function cueTime(cue: string, ctx: AnimCtx): number {
  if (cue === "start") return startTime(ctx);
  if (cue === "end") return Math.max(startTime(ctx), ctx.end - 1.2);
  const v = ctx.vo.find((x) => x.id === cue);
  return v ? Math.max(0, v.t - 0.15) : startTime(ctx);
}

function enter(tl: Scope, l: L, outer: HTMLElement, inn: HTMLElement, t: number, u: number) {
  const k = l.speed;
  const text = inn.querySelector<HTMLElement>(".cl-text");
  let preset: string = l.enter;
  if ((preset === "words" || preset === "letters" || preset === "typewriter") && (!text || l.kind !== "text")) preset = "rise";
  if (preset === "draw" && l.kind === "text") preset = "words";
  switch (preset) {
    case "none": return;
    case "fade": tl.from(inn, t, 0.8 * k, { o: 0 }, "soft"); return;
    case "rise": tl.from(inn, t, 0.9 * k, { y: 40 * u, o: 0, blur: 6 }); return;
    case "drop": tl.from(inn, t, 0.9 * k, { y: -70 * u, o: 0 }, "back"); return;
    case "left": tl.from(inn, t, 0.9 * k, { x: -90 * u, o: 0 }); tl.emit("whoosh", t, { gain: 0.25, pan: -0.4 }); return;
    case "right": tl.from(inn, t, 0.9 * k, { x: 90 * u, o: 0 }); tl.emit("whoosh", t, { gain: 0.25, pan: 0.4 }); return;
    case "scale": tl.from(inn, t, 0.9 * k, { s: 0.6, o: 0 }); return;
    case "pop": tl.from(inn, t, 0.8 * k, { s: 0.2, o: 0 }, "back"); tl.emit("pop", t + 0.1, { gain: 0.25 }); return;
    case "zoom": tl.from(inn, t, 1.1 * k, { s: 1.3, o: 0, blur: 14 }); tl.emit("whoosh", t, { gain: 0.3 }); return;
    case "blur": tl.from(inn, t, 1.0 * k, { o: 0, blur: 12 }); return;
    case "wipe": tl.tw(inn, t, 0.9 * k, { clipX: 0 }, { clipX: 100 }, "inOut"); return;
    case "reveal": tl.tw(inn, t, 0.9 * k, { clipY: 0 }, { clipY: 100 }, "inOut"); return;
    case "iris": tl.tw(inn, t, 1.0 * k, { clipR: 0 }, { clipR: 142 }, "inOut"); return;
    case "draw": {
      if (l.kind === "shape" && l.shape === "line") { tl.tw(inn, t, 1.0 * k, { clipX: 0 }, { clipX: 100 }, "smooth"); return; }
      const strokes = [...inn.querySelectorAll<SVGGeometryElement>(STROKED)].filter((el) => {
        const s = getComputedStyle(el).stroke;
        return s && s !== "none";
      });
      if (!strokes.length) { tl.from(inn, t, 0.9 * k, { o: 0, s: 0.92 }); return; }
      const d = 1.4 * k;
      strokes.forEach((el, j) => {
        el.setAttribute("pathLength", "1");
        el.style.strokeDasharray = el.closest(".cm-arc") ? "0.7 2" : "1 2";
        tl.tw(el, t + j * Math.min(0.12, d / strokes.length), d, { dash: 0 }, { dash: 1 }, "smooth");
      });
      const fills = [...inn.querySelectorAll<SVGElement>(STROKED)].filter((el) => !strokes.includes(el as SVGGeometryElement));
      if (fills.length) tl.from(fills, t + d * 0.55, 0.7, { o: 0 }, "soft");
      return;
    }
    case "words": tl.revealWords(text!, t, 0.055 / k, 0.9 * k, 44 * u); tl.emit("whoosh", t, { gain: 0.3 }); return;
    case "letters": {
      const ws = tl.words(text!);
      const chars: HTMLElement[] = [];
      for (const w of ws) {
        if (!w.querySelector(".ch")) w.innerHTML = [...w.textContent!].map((c) => `<span class="ch">${c.replace(/[&<>]/g, "")}</span>`).join("");
        chars.push(...w.querySelectorAll<HTMLElement>(".ch"));
      }
      const gap = Math.min(0.035, 1.2 / Math.max(1, chars.length)) / k;
      chars.forEach((c, j) => tl.from(c, t + j * gap, 0.7 * k, { y: 30 * u, o: 0 }));
      return;
    }
    case "typewriter": {
      const s = text!.dataset.text ?? "";
      const d = Math.min(2.4, 0.045 * s.length) * k;
      tl.type(text!, t, d, s);
      for (let j = 0; j < s.length; j += 2) tl.emit("type", t + (j / s.length) * d, { gain: 0.45 });
      return;
    }
  }
  void outer;
}

function loop(tl: Scope, l: L, mv: HTMLElement, i: number, a: number, b: number, u: number) {
  if (l.loop === "none") return;
  const ph = i * 1.37;
  const f = {
    float: (t: number) => `translateY(${(Math.sin(t * 1.1 + ph) * 12 * u).toFixed(2)}px)`,
    sway: (t: number) => `rotate(${(Math.sin(t * 0.9 + ph) * 4).toFixed(3)}deg)`,
    spin: (t: number) => `rotate(${((t * 18) % 360).toFixed(3)}deg)`,
    pulse: (t: number) => `scale(${(1 + 0.045 * Math.sin(t * 2.4 + ph)).toFixed(4)})`,
    drift: (t: number) => `translate(${(Math.sin(t * 0.33 + ph) * 22 * u).toFixed(2)}px, ${(Math.cos(t * 0.27 + ph) * 14 * u).toFixed(2)}px)`,
    breathe: (t: number) => `scale(${(1 + 0.06 * Math.sin(t * 0.8 + ph)).toFixed(4)})`,
  }[l.loop];
  tl.fn(a, b - a, (_p, t) => { mv.style.transform = f(t); }, { ease: "linear", continuous: true });
}

/** Particles: each one cycles on its own period, so any frame is a closed-form function of t. */
function particles(tl: Scope, l: Extract<L, { kind: "particles" }>, inn: HTMLElement, a: number, b: number, u: number) {
  const box = inn.parentElement!.parentElement as HTMLElement;
  const W = box.offsetWidth, H = box.offsetHeight;
  const pts = [...inn.querySelectorAll<HTMLElement>(".cm-pt")];
  const P = pts.map(() => ({ x: tl.random(), ph: tl.random(), sp: 0.7 + tl.random() * 0.6, sz: 0.6 + tl.random() * 0.8, y: tl.random(), r: tl.random() }));
  const S = l.style;
  const half: [number, number][] = [];
  for (const [k, pt] of pts.entries()) {
    const q = P[k];
    const base = { steam: 0.5 * W, bubbles: 14 * u, sparkles: 22 * u, confetti: 14 * u, dust: 5 * u, snow: 9 * u, embers: 10 * u, petals: 18 * u }[S] * q.sz;
    const ht = S === "steam" ? base * 1.4 : S === "confetti" ? base * 0.5 : S === "petals" ? base * 0.62 : base;
    pt.style.width = `${base.toFixed(1)}px`;
    pt.style.height = `${ht.toFixed(1)}px`;
    half.push([base / 2, ht / 2]);
  }
  const period = { steam: 3.6, bubbles: 4.2, sparkles: 2.2, confetti: 3.4, dust: 9, snow: 6.5, embers: 3.8, petals: 6 }[S];
  tl.fn(a, b - a, (_p, t) => {
    for (const [k, pt] of pts.entries()) {
      const q = P[k];
      const cyc = (((t - a) / (period / q.sp) + q.ph) % 1 + 1) % 1;
      let x = q.x * W, y = 0, s = 1, r = 0, o = 1;
      switch (S) {
        case "steam": x = (0.2 + q.x * 0.6) * W - 0.17 * W + Math.sin(cyc * 5 + q.ph * 6) * 0.12 * W; y = H * (1 - cyc) - H * 0.25; s = 0.5 + cyc * 1.1; o = Math.sin(cyc * Math.PI) * 0.32; break;
        case "bubbles": case "embers": x += Math.sin(cyc * 6 + q.ph * 9) * 16 * u; y = H * (1 - cyc); o = Math.min(1, Math.sin(cyc * Math.PI) * 1.6) * (S === "embers" ? 0.6 + 0.4 * Math.sin(t * 9 + k) : 0.8); break;
        case "sparkles": y = q.y * H; s = Math.max(0, Math.sin(cyc * Math.PI)); r = cyc * 90; o = s; break;
        case "confetti": case "snow": case "petals": x += Math.sin(cyc * 4 + q.ph * 7) * (S === "confetti" ? 20 : 34) * u; y = cyc * (H + 40 * u) - 20 * u; r = (S === "snow" ? 0 : cyc * 540 * (q.r > 0.5 ? 1 : -1)); o = Math.min(1, (1 - cyc) * 4, cyc * 8); break;
        case "dust": x = (q.x + 0.06 * Math.sin(t * 0.3 + q.ph * 6)) * W; y = (q.y + 0.05 * Math.cos(t * 0.25 + q.ph * 5)) * H; o = 0.25 + 0.5 * Math.abs(Math.sin(t * 0.6 + q.ph * 4)); break;
      }
      pt.style.transform = `translate(${(x - half[k][0]).toFixed(1)}px, ${(y - half[k][1]).toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(${s.toFixed(3)})`;
      pt.style.opacity = o.toFixed(3);
    }
  }, { ease: "linear", continuous: true });
}

export const compose: SceneModule<P> = {
  type: "compose",
  version: 1,
  meta: { label: "Composed scene", category: "custom", description: "", defaultMusicCue: "build" },
  mount(root, p, ctx) {
    const dark = background_(root, p, ctx);
    root.classList.add(dark ? "cm-dark" : "cm-light");
    const cam = h("div", "cm-cam"), frame = h("div", "cm-frame");
    cam.append(frame);
    root.append(cam);
    p.layers.forEach((l, i) => mountLayer(l, i, frame, ctx, dark));
    // cues that name nothing in this scene fall back to its start; layout lint reports them
    const ok = (c?: string) => !c || c === "start" || c === "end" || ctx.vo.some((v) => v.id === c);
    const bad = p.layers.flatMap((l, i) => [l.at, l.until].filter((c) => !ok(c)).map((c) => `layer ${i + 1}: "${c}"`));
    if (bad.length) root.dataset.badCues = `${bad.join(", ")} (cues here: start, end${ctx.vo.map((v) => `, ${v.id}`).join("")})`;
  },
  animate(tl, p, ctx) {
    const u = unit(ctx.stage);
    const root = tl.root as HTMLElement;
    if (p.background.style === "tone") animateBackground(tl, root, ctx);
    const a = ctx.inT ? ctx.inT.start : 0, b = ctx.outT ? ctx.outT.end : ctx.end;
    const cam = root.querySelector<HTMLElement>(".cm-cam")!;
    const m = 40 * u;
    const move = { "push-in": [{ s: 1 }, { s: 1.08 }], "pull-out": [{ s: 1.08 }, { s: 1 }], "pan-left": [{ x: m, s: 1.04 }, { x: -m, s: 1.04 }],
      "pan-right": [{ x: -m, s: 1.04 }, { x: m, s: 1.04 }], rise: [{ y: m * 0.7 }, { y: -m * 0.7 }], drift: null, none: null }[p.camera];
    if (move) tl.tw(cam, a, b - a, move[0], move[1], "linear");
    if (p.camera === "drift") tl.fn(a, b - a, (_q, t) => { cam.style.transform = `translate(${(Math.sin(t * 0.25) * 18 * u).toFixed(2)}px, ${(Math.cos(t * 0.2) * 12 * u).toFixed(2)}px) scale(1.03)`; }, { ease: "linear", continuous: true });

    const layers = [...root.querySelectorAll<HTMLElement>(".cl")];
    p.layers.forEach((l, i) => {
      const outer = layers[i];
      if (!outer) return;
      const mv = outer.querySelector<HTMLElement>(".cl-mv")!, inn = outer.querySelector<HTMLElement>(".cl-in")!;
      const t = Math.max(0, cueTime(l.at, ctx) + l.delay);
      enter(tl, l, outer, inn, t, u);
      if (l.kind === "counter") tl.count(inn.querySelector(".cl-text"), t + 0.1, l.countFor, l.from, l.value, fmtCount(l), "out");
      loop(tl, l, mv, i, a, b, u);
      if (l.kind === "particles") particles(tl, l, inn, a, b, u);
      if (l.kind === "image" && l.zoom !== "none") {
        const img = inn.querySelector<HTMLElement>(".cm-img")!;
        tl.tw(img, a, b - a, { s: l.zoom === "in" ? 1 : 1.1 }, { s: l.zoom === "in" ? 1.1 : 1 }, "linear");
      }
      if (l.until) {
        const x = Math.max(t + 0.6, cueTime(l.until, ctx));
        tl.to(inn, x, 0.45, { y: -24 * u, o: 0, blur: 6 }, "in");
      }
    });
    const x = exitTime(ctx);
    if (p.exit && x !== null) tl.to(root.querySelector(".cm-frame"), Math.max(startTime(ctx) + 1.5, x), 0.42, { y: -30 * u, o: 0, blur: 6 }, "in");
  },
};
