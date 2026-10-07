import type { LintIssue } from "./types.ts";

/** Post-mount layout lint (PLAN §7.6). Runs before any seek, with every element displayed. */
export function lintScene(id: string, root: HTMLElement, stage: { w: number; h: number }, safe: { top: number; right: number; bottom: number; left: number }): LintIssue[] {
  const out: LintIssue[] = [];
  const sr = root.closest("#stage")!.getBoundingClientRect();
  const sx = sr.width / stage.w;
  for (const el of root.querySelectorAll<HTMLElement>(".vs-text")) {
    if (!el.textContent?.trim()) continue;
    const cs = getComputedStyle(el);
    // tight display line-heights let glyphs overhang the line box; allow ~0.25em before calling it overflow
    const slack = 0.25 * parseFloat(cs.fontSize);
    const clipsY = cs.overflowY !== "visible" || cs.maxHeight !== "none" || cs.webkitLineClamp !== "none";
    if (el.scrollWidth > el.clientWidth + 2 || (clipsY && el.scrollHeight > el.clientHeight + slack)) {
        out.push({ level: "warning", scene: id, code: "text-overflow", message: `text overflows its box: "${el.textContent.slice(0, 40)}"` });
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of range.getClientRects()) {
      const x0 = (r.left - sr.left) / sx, y0 = (r.top - sr.top) / sx, x1 = (r.right - sr.left) / sx, y1 = (r.bottom - sr.top) / sx;
      if (x0 < safe.left - 1 || y0 < safe.top - 1 || x1 > stage.w - safe.right + 1 || y1 > stage.h - safe.bottom + 1) {
        out.push({ level: "warning", scene: id, code: "outside-safe-area", message: `text outside safe area: "${el.textContent.slice(0, 40)}"` });
        break;
      }
    }
  }
  for (const img of root.querySelectorAll("img")) {
    if (!img.complete || img.naturalWidth === 0) out.push({ level: "error", scene: id, code: "missing-asset", message: `image failed to load: ${img.getAttribute("src")}` });
  }
  return out;
}
