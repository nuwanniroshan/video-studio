import { useEffect, useState } from "react";
import { Icon } from "./components/ui.tsx";
import { Home } from "./pages/Home.tsx";
import { Templates } from "./pages/Templates.tsx";
import { Idea } from "./pages/Idea.tsx";
import { Brands, BrandEditor } from "./pages/Brands.tsx";
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
  if ((m = h.match(/^#\/p\/([a-z0-9-]+)/))) return <Editor id={m[1]} key={m[1]} />;
  let page;
  if (h.startsWith("#/templates")) page = <Templates />;
  else if (h.startsWith("#/claude")) page = <ClaudeHelp />;
  else if (h.startsWith("#/idea")) page = <Idea />;
  else if ((m = h.match(/^#\/brands\/([a-z0-9-]+)/))) page = <BrandEditor id={m[1] === "new" ? null : m[1]} key={m[1]} />;
  else if (h.startsWith("#/brands")) page = <Brands />;
  else page = <Home />;
  return <Shell h={h}>{page}</Shell>;
}

function Shell({ h, children }: { h: string; children: React.ReactNode }) {
  const nav = (href: string, label: string, icon: React.ReactNode, on: boolean) => <a href={href} className={`nav ${on ? "on" : ""}`}>{icon}{label}</a>;
  return (
    <div className="shell">
      <aside className="side">
        <div className="logo"><i>▶</i>Video Studio</div>
        <a href="#/idea" className="btn primary new-btn">{Icon.plus} New video</a>
        {nav("#/", "Videos", Icon.home, h === "#/" || h.startsWith("#/p/"))}
        {nav("#/templates", "Templates", Icon.grid, h.startsWith("#/templates"))}
        {nav("#/idea", "From an idea", Icon.spark, h.startsWith("#/idea"))}
        {nav("#/brands", "Brand kits", Icon.brush, h.startsWith("#/brands"))}
        <div className="side-foot">
          <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#E0E3FF", fontWeight: 600, marginBottom: 4 }}>{Icon.claude}<span>Ask Claude</span></div>
          Describe a video to Claude and it builds it here. <a href="#/claude">How to set up</a>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
