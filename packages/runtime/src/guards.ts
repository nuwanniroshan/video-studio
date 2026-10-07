import { rand } from "@vs/engine";

/** Determinism guards (PLAN §7.5). */
export function installGuards(seed = 1) {
  Math.random = rand(seed);
  const T = Date.UTC(2026, 0, 1);
  Date.now = () => T;
  const st = document.createElement("style");
  st.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  document.head.append(st);
}
