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
[ -z "${NO_OPEN:-}" ] && ( sleep 2; [ "$(uname)" = Darwin ] && open "http://127.0.0.1:$PORT" ) &
exec env PORT=$PORT npx tsx apps/server/src/main.ts
