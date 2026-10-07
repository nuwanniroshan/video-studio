import type { Timeline } from "@vs/engine";
import type { LintIssue, RuntimeDoc } from "./types.ts";

/** Post-mount layout lint (PLAN §7.6). Runs before any seek, with every element displayed. */
export function lintScene(id: string, root: HTMLElement, stage: { w: number; h: number }, safe: { top: number; right: number; bottom: number; left: number }): LintIssue[] {
  const out: LintIssue[] = [];
  const sr = root.closest("#stage")!.getBoundingClientRect();
  const sx = sr.width / stage.w;
  const box = { l: safe.left * stage.w, t: safe.top * stage.h, r: stage.w - safe.right * stage.w, b: stage.h - safe.bottom * stage.h };
  for (const el of root.querySelectorAll<HTMLElement>(".vs-text")) {
    if (!el.textContent?.trim() || el.closest(".empty")) continue;
    const cs = getComputedStyle(el);
    // tight display line-heights let glyphs overhang the line box; allow ~0.25em before calling it overflow
    const slack = 0.25 * parseFloat(cs.fontSize);
    const clipsY = cs.overflowY !== "visible" || cs.maxHeight !== "none";
    const ellipsis = cs.textOverflow === "ellipsis";
    if (el.scrollWidth > el.clientWidth + 2 || (clipsY && el.scrollHeight > el.clientHeight + slack)) {
      out.push({ level: "warning", scene: id, code: ellipsis ? "text-truncated" : "text-overflow", message: `text ${ellipsis ? "truncated" : "overflows its box"}: "${el.textContent.slice(0, 48)}"` });
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of range.getClientRects()) {
      if (r.width < 1) continue;
      const x0 = (r.left - sr.left) / sx, y0 = (r.top - sr.top) / sx, x1 = (r.right - sr.left) / sx, y1 = (r.bottom - sr.top) / sx;
      if (x0 < box.l - 1 || y0 < box.t - 1 || x1 > box.r + 1 || y1 > box.b + 1) {
        out.push({ level: "warning", scene: id, code: "outside-safe-area", message: `text outside the safe area: "${el.textContent.slice(0, 48)}"` });
        break;
      }
    }
  }
  for (const img of root.querySelectorAll("img")) {
    if (!img.complete || img.naturalWidth === 0) out.push({ level: "error", scene: id, code: "missing-asset", message: `image failed to load: ${img.getAttribute("src")}` });
  }
  // heavy shadows are the most expensive effect on CPU raster (SPIKE.md): warn when many coexist
  let heavy = 0;
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    const bs = getComputedStyle(el).boxShadow;
    if (bs && bs !== "none" && [...bs.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/g)].some((m) => +m[3] >= 40 * (stage.h / 1080))) heavy++;
  }
  if (heavy > 8) out.push({ level: "warning", scene: id, code: "heavy-shadows", message: `${heavy} elements with large shadows (render cost; keep ≤ 8)` });
  return out;
}

/** Timeline lint: sustained heavy blur (> 12 px at 1080p for more than 0.6 s). */
export function lintTimeline(tl: Timeline, d: RuntimeDoc): LintIssue[] {
  const thr = 12 * (Math.min(d.width, d.height) / 1080);
  const out: LintIssue[] = [];
  for (const r of tl.sustained("blur", thr)) {
    if (r.seconds <= 0.6) continue;
    const scene = (r.el.closest("[data-scene]") as HTMLElement | null)?.dataset.scene ?? "?";
    out.push({ level: "warning", scene, code: "sustained-blur", message: `blur above 12 px for ${r.seconds === Infinity ? "the rest of the scene" : r.seconds.toFixed(1) + " s"} (render cost)` });
  }
  return out;
}
