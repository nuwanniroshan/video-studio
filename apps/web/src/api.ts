export type Json = any;
export interface Issue { path: string; message: string }
export interface LintIssue { level: "error" | "warning"; scene: string; code: string; message: string }
export interface SceneDef { type: string; version: number; meta: { label: string; category: string; description: string; defaultMusicCue: string; defaultTransition: Json }; example: Json; schema: Json }
export interface Catalog { scenes: SceneDef[]; tones: string[]; transitions: string[]; musicCues: string[]; aspects: string[]; voices: { id: string; label: string }[]; presets: string[]; qualities: string[] }
export interface PreviewRes { variants: string[]; variant: string; doc: Json; lint: LintIssue[]; duration: number; scenes: { id: string; start: number; end: number; vo: { id: string; t: number; dur: number }[] }[]; warnings: string[]; dropped: string[] }
export interface Job { id: string; project: string; status: "queued" | "running" | "done" | "error"; progress: number; message: string; outputs: { variant: string; files: string[] }[]; error?: string; quality: string; variants: string[] }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : undefined,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 422) throw Object.assign(new Error(data.error ?? r.statusText), { issues: data.issues });
  return data as T;
}
export const api = {
  catalog: () => req<Catalog>("GET", "/api/catalog"),
  templates: () => req<{ id: string; title: string; description: string; scenes: number }[]>("GET", "/api/templates"),
  brands: () => req<{ id: string; name: string; primary: string; logo: string }[]>("GET", "/api/brands"),
  projects: () => req<{ id: string; title: string; brand: string; updated: number; scenes: number; thumbnail?: string; renders: string[] }[]>("GET", "/api/projects"),
  create: (b: { title: string; template: string; brand: string }) => req<{ id: string }>("POST", "/api/projects", b),
  remove: (id: string) => req("DELETE", `/api/projects/${id}`),
  project: (id: string) => req<{ id: string; spec: Json; assets: string[] }>("GET", `/api/projects/${id}`),
  save: (id: string, spec: Json) => req<{ ok: boolean; issues: Issue[] }>("PUT", `/api/projects/${id}/spec`, spec),
  upload: (id: string, f: File) => { const fd = new FormData(); fd.append("file", f); return req<{ path: string }>("POST", `/api/projects/${id}/assets`, fd); },
  preview: (id: string, variant?: string) => req<PreviewRes>("POST", `/api/projects/${id}/preview`, { variant }),
  outputs: (id: string) => req<{ variant: string; files: { name: string; path: string; bytes: number }[] }[]>("GET", `/api/projects/${id}/outputs`),
  render: (id: string, b: { variants?: string[]; quality?: string; deliverables?: "none" | "all" }) => req<Job>("POST", `/api/projects/${id}/renders`, b),
  renders: (id: string) => req<Job[]>("GET", `/api/projects/${id}/renders`),
};
export const fileUrl = (project: string, rel: string) => `/files/${project}/${rel}`;

/** Immutable set at a path like ["scenes", 2, "props", "headline"]. */
export function setIn<T>(obj: T, path: (string | number)[], value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  const copy: any = Array.isArray(obj) ? [...(obj as any)] : { ...(obj as any) };
  if (value === undefined && !rest.length) { if (Array.isArray(copy)) copy.splice(k as number, 1); else delete copy[k]; return copy; }
  copy[k] = setIn(copy[k] ?? (typeof rest[0] === "number" ? [] : {}), rest, value);
  return copy;
}
