/*
 * AI providers (optional; the studio works without any). An agent provider runs a tool-using model that
 * edits a project through the video-studio MCP tools.
 *   claude-code: the local `claude` CLI, headless, using the user's own Claude login (no API key needed).
 * Planned (PLAN §M4): anthropic (API key) and bedrock, behind the same interface.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStreamParser, type AgentEvent } from "./stream.ts";
export * from "./stream.ts";

export interface McpServer { command: string; args: string[]; env?: Record<string, string> }
export interface AgentRun {
  prompt: string;
  system: string;
  mcpServers: Record<string, McpServer>;
  /** fully-qualified tool names the agent may call, e.g. mcp__video-studio__update_spec */
  allowedTools: string[];
  disallowedTools?: string[];
  cwd: string;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent(e: AgentEvent): void;
}
export interface AgentProvider {
  id: string;
  label: string;
  status(): Promise<{ available: boolean; detail: string }>;
  run(r: AgentRun): Promise<{ ok: boolean; text: string; costUsd?: number }>;
}

/**
 * The claude binary. Terminals started from apps (IDEs, the Claude desktop app) often lack ~/.local/bin on PATH, where the
 * native installer puts it, so look in the usual install locations too. VS_CLAUDE_BIN overrides.
 */
export function findClaude(): string | null {
  if (process.env.VS_CLAUDE_BIN) return process.env.VS_CLAUDE_BIN;
  const home = os.homedir();
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), path.join(home, ".local/bin"), path.join(home, ".claude/local"),
    "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".npm-global/bin"), path.join(home, ".bun/bin")];
  for (const d of dirs) {
    if (!d) continue;
    const f = path.join(d, process.platform === "win32" ? "claude.exe" : "claude");
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { /* next */ }
  }
  return null;
}
const NOT_FOUND = "Claude Code was not found. Install it (https://claude.com/claude-code) or set VS_CLAUDE_BIN to the claude binary.";

export const claudeCode: AgentProvider = {
  id: "claude-code",
  label: "Claude (your Claude Code login)",
  async status() {
    const bin = findClaude();
    if (!bin) return { available: false, detail: NOT_FOUND };
    const v = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000 });
    if (v.status !== 0) return { available: false, detail: "Claude Code is not installed (https://claude.com/claude-code), or VS_CLAUDE_BIN is wrong." };
    const a = spawnSync(bin, ["auth", "status"], { encoding: "utf8", timeout: 15000 });
    let logged = false;
    try { logged = !!JSON.parse(a.stdout).loggedIn; } catch { logged = a.status === 0; }
    if (!logged) return { available: false, detail: "Claude Code is installed but not logged in: run `claude` once in a terminal and log in." };
    return { available: true, detail: `Claude Code ${v.stdout.trim().split(" ")[0]}` };
  },
  run(r) {
    return new Promise((resolve) => {
      const args = ["-p", r.prompt, "--output-format", "stream-json", "--verbose", "--system-prompt", r.system,
        "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: r.mcpServers }), "--tools", "",
        "--allowedTools", r.allowedTools.join(","), ...(r.disallowedTools?.length ? ["--disallowedTools", r.disallowedTools.join(",")] : []),
        "--no-session-persistence", "--setting-sources", "", ...(r.model ? ["--model", r.model] : [])];
      // MCP servers must be connected before the first turn, or the model starts without the tools
      const bin = findClaude();
      if (!bin) { r.onEvent({ kind: "error", text: NOT_FOUND }); return resolve({ ok: false, text: NOT_FOUND }); }
      const p = spawn(bin, args, { cwd: r.cwd, env: { ...process.env, MCP_CONNECTION_NONBLOCKING: "0" }, stdio: ["ignore", "pipe", "pipe"] });
      const parse = createStreamParser();
      let buf = "", err = "", final: { ok: boolean; text: string; costUsd?: number } | null = null;
      p.stdout.on("data", (d: Buffer) => {
        buf += d.toString("utf8");
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          for (const e of parse(line)) { if (e.kind === "done") final = { ok: e.ok, text: e.text, costUsd: e.costUsd }; r.onEvent(e); }
        }
      });
      p.stderr.on("data", (d: Buffer) => { err = (err + d.toString("utf8")).slice(-4000); });
      const kill = () => { if (!p.killed) p.kill("SIGTERM"); };
      r.signal?.addEventListener("abort", kill);
      const t = setTimeout(kill, r.timeoutMs ?? 20 * 60_000);
      // a failed spawn emits "error" (and maybe no "close"); unhandled, it would take the whole studio down
      let settled = false;
      p.on("error", (e) => {
        if (settled) return; settled = true;
        clearTimeout(t);
        r.signal?.removeEventListener("abort", kill);
        const text = `Could not start Claude Code: ${e.message}`;
        r.onEvent({ kind: "error", text });
        resolve({ ok: false, text });
      });
      p.on("close", (code) => {
        if (settled) return; settled = true;
        clearTimeout(t);
        r.signal?.removeEventListener("abort", kill);
        if (final) return resolve(final);
        const text = r.signal?.aborted ? "Stopped." : `Claude Code exited (${code}). ${err.trim().split("\n").slice(-3).join(" ")}`.trim();
        r.onEvent({ kind: "error", text });
        resolve({ ok: false, text });
      });
    });
  },
};

export const providers: AgentProvider[] = [claudeCode];
