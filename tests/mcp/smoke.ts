/** MCP smoke test: spawns the stdio server like Claude does and drives the full workflow. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: [path.join(ROOT, "apps/mcp/bin/server.mjs")], cwd: "/tmp", stderr: "ignore" }));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  const t = r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  const imgs = r.content.filter((c: any) => c.type === "image");
  if (r.isError) throw new Error(`${name}: ${t}`);
  return { json: (() => { try { return JSON.parse(t); } catch { return t; } })(), imgs };
};
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.join(", "));
const t = await call("list_templates");
console.log("templates:", t.json.templates.map((x: any) => x.id).join(", "));
const { json: created } = await call("create_project", { title: "MCP smoke" });
const id = created.project;
const spec = created.spec;
spec.scenes[0].props.headline = "Made *by Claude.*";
spec.scenes[0].vo = [{ text: "This video was made by Claude." }];
spec.variants = [spec.variants[0]];
console.log("update_spec:", JSON.stringify((await call("update_spec", { project: id, spec })).json));
const bad = await client.callTool({ name: "update_spec", arguments: { project: id, spec: { ...spec, scenes: [{ id: "x", type: "nope", props: {} }] } } }) as any;
console.log("invalid spec rejected:", bad.isError === true);
const tm = (await call("check_timing", { project: id })).json;
console.log("timing:", tm.duration, "s,", tm.scenes.length, "scenes, lint", tm.lint.length);
const st = await call("render_stills", { project: id });
console.log("stills: images", st.imgs.length, "bytes", st.imgs.map((i: any) => Math.round(i.data.length * 0.75)).join(","));
const job = (await call("render_video", { project: id, quality: "draft", deliverables: "none" })).json.job;
for (;;) {
  const s = (await call("render_status", { job })).json;
  if (s.status === "done" || s.status === "error") { console.log("render:", s.status, s.error ?? "", JSON.stringify(s.outputs)); break; }
  await new Promise((r) => setTimeout(r, 5000));
}
await client.close();
