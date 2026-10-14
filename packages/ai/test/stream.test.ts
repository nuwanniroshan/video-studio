import { describe, expect, it } from "vitest";
import { createStreamParser, shortTool } from "../src/stream.ts";

describe("stream-json parser", () => {
  it("maps init, text, tool calls, tool results and the final result", () => {
    const p = createStreamParser();
    const lines = [
      { type: "system", subtype: "init", model: "claude-sonnet-4-6", tools: ["mcp__video-studio__get_spec", "mcp__video-studio__update_spec"] },
      { type: "assistant", message: { content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "Let me look." }, { type: "tool_use", id: "t1", name: "mcp__video-studio__update_spec", input: { project: "p" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "bad" }] }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "ok" }, { type: "image", source: {} }] }] } },
      { type: "result", subtype: "success", is_error: false, result: "Done.", total_cost_usd: 0.12, num_turns: 4, duration_ms: 9000 },
    ];
    const ev = lines.flatMap((l) => p(JSON.stringify(l)));
    expect(ev.map((e) => e.kind)).toEqual(["start", "say", "tool", "tool-result", "tool-result", "done"]);
    expect(ev[0]).toMatchObject({ tools: ["get_spec", "update_spec"] });
    expect(ev[2]).toMatchObject({ name: "update_spec", input: { project: "p" } });
    expect(ev[3]).toMatchObject({ name: "update_spec", ok: false, text: "bad", images: 0 });
    expect(ev[4]).toMatchObject({ ok: true, images: 1 });
    expect(ev[5]).toMatchObject({ ok: true, text: "Done.", costUsd: 0.12, turns: 4 });
  });
  it("ignores junk and unknown lines", () => {
    const p = createStreamParser();
    expect(p("not json")).toEqual([]);
    expect(p(JSON.stringify({ type: "rate_limit_event" }))).toEqual([]);
  });
  it("shortens MCP tool names", () => {
    expect(shortTool("mcp__video-studio__render_stills")).toBe("render_stills");
    expect(shortTool("Read")).toBe("Read");
  });
});
