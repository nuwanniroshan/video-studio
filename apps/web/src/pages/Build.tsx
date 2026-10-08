import { useEffect, useState } from "react";
import { api, navigate, type AgentJob, type Json } from "../api.ts";
import { AgentLog, plain, useAgentJob } from "../components/AgentLog.tsx";
import { Icon, Spinner } from "../components/ui.tsx";

/** Watching the agent build (or revise) a video: live steps on the left, the latest frames on the right. */
export function Build({ id, job: jobId }: { id: string; job: string }) {
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState<Json>({});
  const [ask, setAsk] = useState("");
  const [current, setCurrent] = useState(jobId);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<AgentJob | null>(null);
  useEffect(() => { api.project(id).then((p) => setTitle(p.spec.title)); api.request(id).then(setRequest); }, [id]);
  useEffect(() => setCurrent(jobId), [jobId]);
  const live = useAgentJob(current, () => api.project(id).then((p) => setTitle(p.spec.title)));
  // a finished run from an earlier session isn't live any more: read it from the project
  useEffect(() => { const t = setTimeout(() => { if (!live) api.agentJobs(id).then((js) => setSaved(js.find((j) => j.id === current) ?? null)); }, 1200); return () => clearTimeout(t); }, [current, live, id]);
  const job = live ?? saved;
  const running = job?.status === "running";
  const sheets = job?.steps.filter((s) => s.kind === "sheet") ?? [];
  const latest = sheets.slice(-2);
  const revise = async () => {
    setBusy(true);
    try { const j = await api.agent(id, { mode: "revise", instruction: ask }); setAsk(""); navigate(`#/p/${id}/build/${j.id}`); }
    catch (e) { alert((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="page build">
      <div className="page-head">
        <div><a href="#/" className="muted small">← Videos</a><h1>{title || "New video"}</h1>
          <p>{running ? "The agent is writing the script, choosing scenes and checking how every frame looks." : job?.status === "done" ? "Your video is ready to preview, edit and render." : job ? "The agent stopped. Everything it saved is in the editor." : "Connecting…"}</p></div>
        <span className="spacer" />
        {running && <button className="btn" onClick={() => api.stopAgent(current)}>{Icon.stop} Stop</button>}
        <a className={`btn ${running ? "" : "primary lg"}`} href={`#/p/${id}`}>{running ? "Open editor" : <>{Icon.play} Preview and edit</>}</a>
      </div>
      <div className="buildgrid">
        <div className="card agentcard">
          <div className="agenthead">
            <span className={`orb ${running ? "live" : job?.status}`}>{Icon.wand}</span>
            <div><b>Video agent</b><span className="tiny muted">{job ? `${job.mode === "create" ? "Creating" : "Revising"} · ${job.model === "opus" ? "Best quality" : "Fast"}${job.revisions ? ` · ${job.revisions} saves` : ""}` : ""}</span></div>
          </div>
          {request.idea && job?.mode === "create" && <div className="brief"><span className="tiny muted">Your idea</span><p>{request.idea}</p></div>}
          {job?.mode === "revise" && <div className="brief"><span className="tiny muted">You asked</span><p>{job.instruction}</p></div>}
          {job ? <AgentLog job={job} compact /> : <div className="row muted"><Spinner /> Connecting to the agent…</div>}
          {job && !running && job.summary && <div className={`asummary ${job.status}`}><b>{job.status === "done" ? "Done" : "Note"}</b><p>{plain(job.summary)}</p></div>}
          {job && !running && (
            <div className="askbox">
              <textarea rows={2} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask for changes, e.g. “make it punchier and add a scene about pricing”" />
              <button className="btn primary" disabled={!ask.trim() || busy} onClick={revise}>{busy ? <Spinner /> : Icon.wand} Ask the agent</button>
            </div>)}
        </div>
        <div className="col" style={{ gap: 12 }}>
          {latest.length ? latest.map((s, i) => <a key={i} href={s.image} target="_blank" rel="noreferrer" className="sheetview"><img src={s.image} alt="Frames" /></a>)
            : <div className="sheetview empty-sheet">{running ? <><Spinner /> Frames appear here once the first draft is written</> : "No frames rendered in this run"}</div>}
          <p className="help">Contact sheets: key moments of every scene, as the agent sees them while reviewing. Open the editor to play it with sound.</p>
        </div>
      </div>
    </div>
  );
}
