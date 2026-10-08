/** Claude Code `--output-format stream-json` lines → agent events (pure; unit-tested). */
export type AgentEvent =
  | { kind: "start"; model?: string; tools: string[] }
  | { kind: "say"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown }
  | { kind: "tool-result"; id: string; name: string; ok: boolean; text: string; images: number }
  | { kind: "done"; ok: boolean; text: string; costUsd?: number; turns?: number; durationMs?: number }
  | { kind: "error"; text: string };

/** Strip the "mcp__<server>__" prefix. */
export const shortTool = (n: string) => n.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");

export function createStreamParser() {
  const names = new Map<string, string>();
  return (line: string): AgentEvent[] => {
    let m: any;
    try { m = JSON.parse(line); } catch { return []; }
    const out: AgentEvent[] = [];
    if (m.type === "system" && m.subtype === "init") out.push({ kind: "start", model: m.model, tools: (m.tools ?? []).map(shortTool) });
    else if (m.type === "assistant") {
      for (const c of m.message?.content ?? []) {
        if (c.type === "text" && c.text?.trim()) out.push({ kind: "say", text: c.text.trim() });
        if (c.type === "tool_use") { names.set(c.id, shortTool(c.name)); out.push({ kind: "tool", id: c.id, name: shortTool(c.name), input: c.input }); }
      }
    } else if (m.type === "user") {
      for (const c of Array.isArray(m.message?.content) ? m.message.content : []) {
        if (c.type !== "tool_result") continue;
        const parts = Array.isArray(c.content) ? c.content : [{ type: "text", text: String(c.content ?? "") }];
        out.push({ kind: "tool-result", id: c.tool_use_id, name: names.get(c.tool_use_id) ?? "?", ok: !c.is_error,
          text: parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n"), images: parts.filter((p: any) => p.type === "image").length });
      }
    } else if (m.type === "result") {
      out.push({ kind: "done", ok: !m.is_error && m.subtype === "success", text: String(m.result ?? (m.subtype ?? "")),
        costUsd: m.total_cost_usd, turns: m.num_turns, durationMs: m.duration_ms });
    }
    return out;
  };
}
