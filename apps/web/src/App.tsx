import { useEffect, useState } from "react";
import { Projects } from "./Projects.tsx";
import { Editor } from "./Editor.tsx";

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return h;
}

export function App() {
  const h = useHash();
  const m = h.match(/^#\/p\/([a-z0-9-]+)/);
  return m ? <Editor id={m[1]} key={m[1]} /> : <Projects />;
}
