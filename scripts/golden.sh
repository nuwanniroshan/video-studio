#!/usr/bin/env bash
# Golden frames + determinism inside the pinned render image (PLAN §14).
#   scripts/golden.sh            compare against tests/golden/baseline
#   scripts/golden.sh --update   refresh the baselines (commit them)
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -q -f docker/Dockerfile.render -t studio-render:test . >/dev/null
docker run --rm -u "$(id -u)" --tmpfs /tmp:exec,mode=1777 -v "$PWD/tests/golden/baseline:/app/tests/golden/baseline" --entrypoint bash studio-render:test -lc \
  "npx tsx tests/golden/run.ts $* && npx tsx tests/determinism/run.ts"
