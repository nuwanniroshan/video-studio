#!/usr/bin/env bash
# Adds the video-studio MCP server to Claude Desktop (macOS). Backs up the config first.
# Then quit and reopen Claude Desktop; the tools appear under the "+" / tools menu.
set -euo pipefail
cd "$(dirname "$0")/.."
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
NODE=$(command -v node)   # absolute path: GUI apps don't see nvm's PATH
SERVER="$PWD/apps/mcp/bin/server.mjs"
mkdir -p "$(dirname "$CFG")"
[ -f "$CFG" ] && cp "$CFG" "$CFG.bak.$(date +%Y%m%d%H%M%S)"
python3 - "$CFG" "$NODE" "$SERVER" "$(dirname "$NODE")" <<'PY'
import json, os, sys
cfg, node, server, nodedir = sys.argv[1:]
d = json.load(open(cfg)) if os.path.exists(cfg) and os.path.getsize(cfg) else {}
d.setdefault("mcpServers", {})["video-studio"] = {
    "command": node, "args": [server],
    # ffmpeg/espeak from Homebrew and node itself must be on PATH for renders
    "env": {"PATH": f"{nodedir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"},
}
json.dump(d, open(cfg, "w"), indent=2)
print("added video-studio to", cfg)
PY
echo "Restart Claude Desktop, then ask: \"Make a 30-second launch video for …\""
