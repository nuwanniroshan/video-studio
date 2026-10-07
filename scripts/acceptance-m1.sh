#!/usr/bin/env bash
# M1 acceptance (PLAN §13), locally: lint, full render (16:9 + 9:16) with deliverables, one-scene edit
# re-render ratio, loudness, Whisper QA. Golden + determinism run separately in the image: scripts/golden.sh
# Output: out/m1/ (gitignored). Usage: scripts/acceptance-m1.sh [workers]
set -euo pipefail
cd "$(dirname "$0")/.."
W=${1:-7}
VS="node apps/cli/bin/vs.mjs"
M=out/m1; rm -rf "$M"; mkdir -p "$M"
cp -r templates/feature-launch "$M/project"
SPEC=$M/project/spec.json
now() { python3 -c 'import time;print(time.time())'; }
# TTS is cached in .vs-cache/vo; segment and mix caches start cold for each measurement
fresh_cache() { rm -rf "$1"; mkdir -p "$1"; [ -d .vs-cache/vo ] && cp -r .vs-cache/vo "$1/" || true; }

echo "== lint"
fresh_cache $M/cache
VS_CACHE=$PWD/$M/cache $VS lint $SPEC < /dev/null 2>&1 | tee $M/lint.txt

echo "== full render, both variants, all deliverables"
t0=$(now)
VS_CACHE=$PWD/$M/cache $VS render $SPEC -o $M/full -d all -w $W --json < /dev/null > $M/full.json 2> $M/full.log
t1=$(now)
grep -E "✓|LUFS" $M/full.log
echo "wall: $(python3 -c "print(round($t1-$t0,1))") s"

echo "== one-scene text edit (main)"
fresh_cache $M/cache-edit
t0=$(now); VS_CACHE=$PWD/$M/cache-edit $VS render $SPEC -v main -o $M/base -d none -w $W < /dev/null 2> $M/base.log; t1=$(now)
python3 - "$SPEC" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
[s for s in d['scenes'] if s['id']=='grid'][0]['props']['headline']='Everything payroll needs, *built in.*'
json.dump(d,open(p,'w'),indent=2)
PY
t2=$(now); VS_CACHE=$PWD/$M/cache-edit $VS render $SPEC -v main -o $M/edit -d none -w $W < /dev/null 2> $M/edit.log; t3=$(now)
python3 - <<PY
full=$t1-$t0; edit=$t3-$t2
print(f"full main render: {full:.1f} s   edited re-render: {edit:.1f} s   ratio: {100*edit/full:.1f}% (target < 25%)")
PY
grep "segments" $M/edit.log | head -2

echo "== loudness (ffmpeg ebur128)"
for v in main social; do
  echo -n "$v: "; ffmpeg -hide_banner -i $M/full/$v/mix.wav -af ebur128=peak=true -f null - 2>&1 | grep -A12 Summary | grep -E "I:|Peak:" | tr -s ' ' | tr '\n' ' '; echo
done

echo "== whisper QA"
VS_CACHE=$PWD/$M/cache $VS qa $SPEC < /dev/null 2>&1 | tee $M/qa.txt || true

echo "== contact sheets"
for v in main social; do $VS sheet $M/full/$v/Payroll_launch_$v.mp4 --every 1.8 < /dev/null; done
