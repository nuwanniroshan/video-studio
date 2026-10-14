#!/usr/bin/env bash
# Local video studio (M2-minimum): checks/installs dependencies, builds the UI, starts http://127.0.0.1:5190
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-5190}
echo "Checking dependencies (installs only what's missing; the first run takes a few minutes)…"
source scripts/lib/setup.sh && vs_setup
# rebuild runtime + web UI when sources changed
if [ -n "$(find packages/runtime/src packages/scenes/src packages/engine/src -newer packages/runtime/dist/runtime.js -print -quit 2>/dev/null)" ]; then (cd packages/runtime && node build.mjs >/dev/null); fi
if [ ! -f apps/web/dist/index.html ] || [ -n "$(find apps/web/src apps/web/index.html -newer apps/web/dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "Building the studio UI…"; (cd apps/web && npx vite build --logLevel warn)
fi
# an older studio still holding the port would keep serving old code: replace it (anything else on the port is left alone)
OLD=$(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$OLD" ]; then
  if ps -o command= -p "$OLD" | grep -q "apps/server/src/main.ts"; then
    echo "Restarting the studio already running on port $PORT (pid $OLD)…"
    kill "$OLD"; for _ in 1 2 3 4 5 6 7 8 9 10; do lsof -t -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.5; done
  else
    echo "Port $PORT is used by another program (pid $OLD). Stop it, or run: PORT=5191 pnpm studio" >&2; exit 1
  fi
fi
[ -z "${NO_OPEN:-}" ] && ( sleep 2; [ "$(uname)" = Darwin ] && open "http://127.0.0.1:$PORT" ) &
exec env PORT=$PORT npx tsx apps/server/src/main.ts
