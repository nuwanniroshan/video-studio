#!/usr/bin/env bash
# M0 benchmark matrix. Usage: scripts/spike-bench.sh <label> <workers> [out.jsonl]
# Runs the title clip at every tier and the stress probes at standard; one JSON line per run.
set -euo pipefail
label=$1; W=$2; out=${3:-out/spike/bench-$label.jsonl}
mkdir -p "$(dirname "$out")"
run() { npx tsx packages/render/scripts/spike.ts bench "$@" 2>/dev/null | grep '^{' | sed "s/^{/{\"env\":\"$label\",/" | tee -a "$out"; }
for q in draft standard cinema; do run title $q "$W" 8; done
for m in plain blur 3d shadow; do run $m standard "$W" 4 --no-dedupe; done
