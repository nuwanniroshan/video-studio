/** Escape user text, then turn `*payoff*` into the two-tone accent span (house style). */
export function richText(s: string): string {
  const esc = s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
  return esc.replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>').replace(/\n/g, "<br/>");
}
export const plain = (s: string) => s.replace(/\*/g, "");

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
}
