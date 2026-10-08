import { useEffect, useState } from "react";
import { Icon } from "./components/ui.tsx";
import { api } from "./api.ts";
import { Home } from "./pages/Home.tsx";
import { Templates } from "./pages/Templates.tsx";
import { Create } from "./pages/Create.tsx";
import { Build } from "./pages/Build.tsx";
import { ProjectBrand } from "./pages/ProjectBrand.tsx";
import { Watch } from "./pages/Watch.tsx";
import { Editor } from "./Editor.tsx";
import { ClaudeHelp } from "./pages/ClaudeHelp.tsx";

function useHash() {
  const [h, setH] = useState(location.hash || "#/");
  useEffect(() => { const f = () => { setH(location.hash || "#/"); window.scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return h;
}

export function App() {
  const h = useHash();
  let m: RegExpMatchArray | null;
  if ((m = h.match(/^#\/p\/([a-z0-9-]+)\/watch/))) return <Shell h={h}><Watch id={m[1]} key={m[1]} /></Shell>;
  if ((m = h.match(/^#\/p\/([a-z0-9-]+)\/build\/([a-z0-9-]+)/))) return <Shell h={h}><Build id={m[1]} job={m[2]} key={m[1]} /></Shell>;
  if ((m = h.match(/^#\/p\/([a-z0-9-]+)\/brand/))) return <Shell h={h}><ProjectBrand id={m[1]} key={m[1]} /></Shell>;
  if ((m = h.match(/^#\/p\/([a-z0-9-]+)/))) return <Editor id={m[1]} key={m[1]} />;
  let page;
  if (h.startsWith("#/templates")) page = <Templates />;
  else if (h.startsWith("#/claude")) page = <ClaudeHelp />;
  else if (h.startsWith("#/new") || h.startsWith("#/idea")) page = <Create key={h} />;
  else page = <Home />;
  return <Shell h={h}>{page}</Shell>;
}

function Shell({ h, children }: { h: string; children: React.ReactNode }) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const check = () => api.health().then((x) => setStale(x.stale)).catch(() => undefined);
    check(); const t = setInterval(check, 30_000); return () => clearInterval(t);
  }, []);
  const nav = (href: string, label: string, icon: React.ReactNode, on: boolean) => <a href={href} className={`nav ${on ? "on" : ""}`}>{icon}{label}</a>;
  return (
    <div className="shell">
      <aside className="side">
        <div className="logo"><i>▶</i>Video Studio</div>
        <a href="#/new" className="btn primary new-btn">{Icon.plus} New video</a>
        {nav("#/", "Videos", Icon.home, h === "#/" || h.startsWith("#/p/"))}
        {nav("#/new", "Create with AI", Icon.wand, h.startsWith("#/new"))}
        {nav("#/templates", "Templates", Icon.grid, h.startsWith("#/templates"))}
        <div className="side-foot">
          <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#E0E3FF", fontWeight: 600, marginBottom: 4 }}>{Icon.claude}<span>Ask Claude</span></div>
          Describe a video to Claude and it builds it here. <a href="#/claude">How to set up</a>
        </div>
      </aside>
      <main className="main">
        {stale && <div className="banner warn stale">The studio's code was updated while it was running. Restart it (stop it and run <code>pnpm studio</code> again) so new videos use the latest scenes and agent.</div>}
        {children}</main>
    </div>
  );
}
