import { useEffect, useRef, useState } from "react";
import type { AgentJob, AgentStep } from "../api.ts";
import { Icon, Spinner } from "./ui.tsx";

/** Follow an agent run live (server-sent events). */
export function useAgentJob(jobId: string | null | undefined, onFinish?: (j: AgentJob) => void) {
  const [job, setJob] = useState<AgentJob | null>(null);
  const fin = useRef(onFinish); fin.current = onFinish;
  useEffect(() => {
    if (!jobId) { setJob(null); return; }
    const es = new EventSource(`/api/agent/${jobId}/events`);
    let done = false;
    es.onmessage = (m) => {
      const j = JSON.parse(m.data) as AgentJob; setJob(j);
      if (j.status !== "running" && !done) { done = true; es.close(); fin.current?.(j); }
    };
    es.onerror = () => { if (!done) es.close(); };
    return () => es.close();
  }, [jobId]);
  return job;
}

/** Model text without markdown emphasis or code marks. */
export const plain = (t: string) => t.replace(/\*\*|__|`/g, "").replace(/(^|[\s(“"])\*(?=\S)|(?<=\S)\*(?=[\s.,;:!?)”"]|$)/g, "$1");
const since = (a: number, b: number) => { const s = Math.max(0, Math.round((a - b) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

/** The agent's work as a readable timeline. Long thoughts collapse; contact sheets show inline. */
export function AgentLog({ job, compact }: { job: AgentJob; compact?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (job.status !== "running") return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [job.status]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [job.steps.length]);
  const steps = job.steps.filter((s, i) => s.kind !== "sheet" || !compact || i === job.steps.map((x) => x.kind).lastIndexOf("sheet"));
  return (
    <div className={`alog ${compact ? "compact" : ""}`}>
      {steps.map((s, i) => <Step key={i} s={s} t={since(s.at, job.started)} live={job.status === "running" && s.kind === "tool" && s.ok === undefined} />)}
      {job.status === "running" && <div className="astep thinking"><span className="aic"><Spinner /></span><span className="muted">Working… {since(now, job.started)}</span></div>}
      <div ref={end} />
    </div>
  );
}

function Step({ s, t, live }: { s: AgentStep; t: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (s.kind === "say") {
    const long = s.text.length > 220;
    return <div className="astep say"><span className="aic">✦</span>
      <div className={`bubble ${long && !open ? "clamp" : ""}`} onClick={() => long && setOpen(!open)}>{plain(s.text)}{long && <span className="more">{open ? "Show less" : "Show more"}</span>}</div></div>;
  }
  if (s.kind === "sheet") return <div className="astep sheet"><span className="aic">{Icon.film}</span><a href={s.image} target="_blank" rel="noreferrer"><img src={s.image} alt="Contact sheet" /></a></div>;
  const ic = s.kind === "done" ? Icon.check : s.kind === "error" || s.ok === false ? "!" : s.kind === "tool" ? (live ? <Spinner /> : Icon.check) : "•";
  return (
    <div className={`astep ${s.kind} ${s.ok === false ? "bad" : ""}`}>
      <span className="aic">{ic}</span>
      <div className="atext"><span>{s.text}</span>{s.detail && <span className="adetail">{s.detail}</span>}</div>
      <span className="at">{t}</span>
    </div>
  );
}
