# Making videos by talking to Claude

The `video-studio` MCP server (`apps/mcp`) exposes the pipeline as tools. You describe an idea, and Claude does the rest:
- plans the storyboard;
- writes the spec;
- checks the contact sheets visually and fixes the layout;
- renders.

Projects are shared with the web studio (`pnpm studio`), so you can open anything Claude made and tweak it by hand.

**Tools:**
- `list_templates`, `list_scenes`, `get_scene_schema`
- `list_projects`, `create_project`, `get_spec`, `update_spec`, `add_asset`
- `check_timing` (voice-over + timing + lint)
- `render_stills` (returns the contact sheet image)
- `render_video`, `render_status`, `list_outputs`

## Inside the web studio (no setup)

`New video → Create with AI` and the editor's **Ask AI** run the same agent without leaving the studio. The server starts
`claude -p` headlessly with only the `video-studio` MCP server and only its editing tools (no shell, no file access, no rendering),
streams its steps to the page and saves its run log in `<project>/agent/`. It uses your Claude Code login; set `VS_CLAUDE_BIN` if
`claude` is not on the PATH and `VS_AGENT_MODEL` (`sonnet` default, `opus`) to change the default model. If Claude Code is missing
or logged out, the studio says so and creates a rule-based draft instead.

Measured here: a new 30 s video from an idea took 2–4.5 minutes (about $0.20 of usage) and came back with 0 lint issues in both
formats; a revision ("add a stats scene, punchier hook") took 1.5 minutes.

## Options compared

| Where you talk to Claude | How | Works now? | Notes |
|---|---|---|---|
| **Claude Code, in this repo** | `.mcp.json` in the repo root, plus the `video-studio` skill | ✅ | Approve the server on first launch. Best for technical users. |
| **Claude Code, from any folder** | Plugin `plugins/video-studio` (MCP server + `make-video` skill) via the local marketplace | ✅ | One-time install, below. |
| **Claude Desktop app (chat)** | Local MCP server in Desktop's config | ✅ | `scripts/install-claude-desktop.sh`. Renders run on this Mac. |
| Claude Desktop, one-click install | Desktop Extension (`.mcpb`) | Later | Needs the server bundled with its dependencies (Chromium, Python, models are large). Revisit after M2. |
| claude.ai web / mobile (custom connector) | **Remote** MCP over HTTPS | ❌ not yet | Connectors can't reach a local server. Needs the same tools hosted (M2 on AWS: `studio-web` + render workers), with auth. |

Recommendation:
- **Now:** Claude Desktop or Claude Code on your Mac.
- **After M2 is deployed:** add a streamable-HTTP transport to the same server behind the studio's login. It then becomes a custom connector on claude.ai and mobile, with renders running on Fargate.

## Setup

**Claude Code, in this repo.** Run `claude` in the repo. The project's `.mcp.json` offers the `video-studio` server; approve it.

**Claude Code, anywhere (plugin).** Inside Claude Code:

```
/plugin marketplace add /Users/swiveltech/Disk/Swivel/video-studio
/plugin install video-studio@video-studio-local
```

If the repo moves, set `VIDEO_STUDIO_HOME` to its path.

**Claude Desktop:**

```bash
scripts/install-claude-desktop.sh
```

Then quit and reopen Claude Desktop.

## Try it

> Make a 30-second launch video for our new leave-tracking feature. Audience: HR managers. End with "Book a demo". Also give me a 9:16 version for LinkedIn.

Claude creates the project, writes the scenes and voice-over, shows you the contact sheet, renders a draft, then the final. It reports the file paths and a link into the web studio.

## Testing

`npx tsx tests/mcp/smoke.ts` spawns the server the way Claude does and drives the full workflow, ending with a draft render.
