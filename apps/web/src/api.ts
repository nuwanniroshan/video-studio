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
export interface Template { id: string; name: string; category: string; description: string; length: string; formats: string[]; scenes: string[]; thumbnail?: string }
export interface BrandKit { id: string; name: string; base?: { primary: string; accent: string; dark: string; light: string; ink: string }; colors: Record<string, string>;
  fonts: Record<string, { family: string; file: string }>; logo: Record<string, string>; voice?: { voice: string; speed: number };
  pronunciations?: Record<string, { ipa?: string; respell?: string }>; cta?: { url: string }; music?: { preset: string };
  urls: { logoOnDark?: string; logoOnLight?: string; mark?: string; fonts: Record<string, string> } }
export interface FontOpt { id: string; family: string; file: string; style: string; roles: string[]; url: string }
export interface Brief { goal: string; product: string; message: string; problem?: string; audience?: string; points: { title: string; detail?: string }[];
  stat?: { value: number; suffix?: string; prefix?: string; label: string }; cta: string; ctaLine?: string; url?: string; mood?: string; length?: number;
  formats?: string[]; screenshots?: string[]; voice?: string; brand?: string; title?: string }

export const api = {
  catalog: () => req<Catalog>("GET", "/api/catalog"),
  templates: () => req<Template[]>("GET", "/api/templates"),
  brandkits: () => req<BrandKit[]>("GET", "/api/brandkits"),
  brandkit: (id: string) => req<BrandKit>("GET", `/api/brandkits/${id}`),
  saveBrand: (id: string | null, b: Json) => req<BrandKit>(id ? "PUT" : "POST", id ? `/api/brandkits/${id}` : "/api/brandkits", b),
  deleteBrand: (id: string) => req("DELETE", `/api/brandkits/${id}`),
  brandFile: (id: string, kind: string, f: File) => { const fd = new FormData(); fd.append("file", f); return req<BrandKit>("POST", `/api/brandkits/${id}/files?kind=${kind}`, fd); },
  fonts: () => req<FontOpt[]>("GET", "/api/fonts"),
  voiceTest: async (b: { text: string; voice?: string; speed?: number; pronunciations?: Json; brand?: string }) => {
    const r = await fetch("/api/voice-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "voice test failed");
    return URL.createObjectURL(await r.blob());
  },
  upload: (f: File) => { const fd = new FormData(); fd.append("file", f); return req<{ ref: string }>("POST", "/api/uploads", fd); },
  briefPreview: (b: Brief) => req<Json>("POST", "/api/brief-preview", b),
  fromBrief: (b: Brief) => req<{ id: string }>("POST", "/api/projects/from-brief", b),
  previewAudio: (id: string, variant?: string) => req<{ url: string; lufs: number }>("POST", `/api/projects/${id}/preview-audio`, { variant }),
  brands: () => req<{ id: string; name: string; primary: string; logo: string }[]>("GET", "/api/brands"),
  projects: () => req<{ id: string; title: string; brand: string; updated: number; scenes: number; thumbnail?: string; renders: string[] }[]>("GET", "/api/projects"),
  create: (b: { title: string; template: string; brand: string; formats?: string[] }) => req<{ id: string }>("POST", "/api/projects", b),
  remove: (id: string) => req("DELETE", `/api/projects/${id}`),
  project: (id: string) => req<{ id: string; spec: Json; assets: string[] }>("GET", `/api/projects/${id}`),
  save: (id: string, spec: Json) => req<{ ok: boolean; issues: Issue[] }>("PUT", `/api/projects/${id}/spec`, spec),
  uploadAsset: (id: string, f: File) => { const fd = new FormData(); fd.append("file", f); return req<{ path: string }>("POST", `/api/projects/${id}/assets`, fd); },
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

export const SCENE_ICON: Record<string, string> = { kineticTitle: "Aa", logoReveal: "◎", featureSpotlight: "▣", featureGrid: "▦", screenFlow: "⌖", statsCounter: "#", mediaBroll: "▨", ctaEndCard: "➔" };
export const SCENE_NAME: Record<string, string> = { kineticTitle: "Title", logoReveal: "Logo reveal", featureSpotlight: "Feature spotlight", featureGrid: "Feature grid",
  screenFlow: "Screen flow", statsCounter: "Stats", mediaBroll: "Photo", ctaEndCard: "Call to action" };
export const ASPECT_NAME: Record<string, string> = { "16:9": "Landscape", "9:16": "Vertical", "1:1": "Square", "4:5": "Feed" };
export const ASPECT_USE: Record<string, string> = { "16:9": "Web, YouTube", "9:16": "Reels, TikTok", "1:1": "LinkedIn, X", "4:5": "Instagram" };
export function timeAgo(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}
export const navigate = (h: string) => { location.hash = h; };
