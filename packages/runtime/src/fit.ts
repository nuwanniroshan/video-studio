/** Binary-search the largest font size (px) in [min, max] at which `el` fits its width and `maxHeight`. */
export function fitText(el: HTMLElement, opt: { min: number; max: number; maxHeight?: number }): number {
  const fitsAt = (px: number) => {
    el.style.fontSize = px + "px";
    return el.scrollWidth <= el.clientWidth + 1 &&
      (opt.maxHeight === undefined || el.scrollHeight <= opt.maxHeight + 1) &&
      !wordOverflow(el);
  };
  let best = opt.min;
  if (fitsAt(opt.max)) best = opt.max;
  else {
    let lo = opt.min, hi = opt.max;
    for (let i = 0; i < 14 && hi - lo > 0.25; i++) {
      const mid = (lo + hi) / 2;
      if (fitsAt(mid)) { best = mid; lo = mid; } else hi = mid;
    }
  }
  el.style.fontSize = best.toFixed(2) + "px";
  el.dataset.fitPx = best.toFixed(2);
  return best;
}

/** A single word wider than its container overflows without always changing scrollWidth. */
function wordOverflow(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width > r.width + 1;
}
