#!/usr/bin/env bash
# One command, start to finish: setup (only what's missing) → project from a template (if new) →
# voice-over + timing → stills/contact sheets → lint → render + deliverables.
#
#   pnpm video                                   # renders the feature-launch template into ./my-video
#   pnpm video my-launch                         # project dir (created from the template if it doesn't exist)
#   pnpm video my-launch/spec.json -q cinema     # an existing spec, cinema quality
#
# Options (all optional):
#   -t, --template <name>      template for a new project       (default: feature-launch)
#   -b, --brand <id>           brand kit for a new project       (default: luraplus)
#   -q, --quality <tier>       draft | standard | cinema         (default: the spec's quality)
#   -v, --variant <ids>        comma-separated variants          (default: all)
#   -d, --deliverables <sets>  none | all | master,web,…         (default: all)
#       --grain                add film grain to deliverables
#       --skip-setup           don't check/install dependencies
#       --open                 open the output folder when done (macOS)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD

target="my-video"; template="feature-launch"; brand="luraplus"; quality=""; variant=""; deliv="all"
grain=""; skip_setup=""; open_out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--template) template=$2; shift 2 ;;
    -b|--brand) brand=$2; shift 2 ;;
    -q|--quality) quality=$2; shift 2 ;;
    -v|--variant) variant=$2; shift 2 ;;
    -d|--deliverables) deliv=$2; shift 2 ;;
    --grain) grain=1; shift ;;
    --skip-setup) skip_setup=1; shift ;;
    --open) open_out=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    -*) echo "unknown option $1 (see --help)"; exit 1 ;;
    *) target=$1; shift ;;
  esac
done

step() { printf "\n\033[1;34m▸ %s\033[0m\n" "$1"; }
die() { printf "\033[1;31m✗ %s\033[0m\n" "$1"; exit 1; }
VS="node $ROOT/apps/cli/bin/vs.mjs"
t0=$(date +%s)

# ---------------------------------------------------------------- setup (idempotent)
if [ -z "$skip_setup" ]; then
  step "Checking dependencies"
  source scripts/lib/setup.sh && vs_setup
fi
# always rebuild the runtime bundle if sources are newer (cheap)
if [ -n "$(find packages/runtime/src packages/scenes/src packages/engine/src -newer packages/runtime/dist/runtime.js -print -quit 2>/dev/null)" ]; then
  (cd packages/runtime && node build.mjs >/dev/null)
fi

# ---------------------------------------------------------------- project
if [ -f "$target" ]; then spec=$target
elif [ -f "$target/spec.json" ]; then spec=$target/spec.json
else
  step "Creating project $target from template \"$template\" (brand $brand)"
  $VS init "$target" --template "$template" --brand "$brand"
  spec=$target/spec.json
fi
spec_dir=$(cd "$(dirname "$spec")" && pwd)
vopt=(); [ -n "$variant" ] && vopt=(-v "$variant")

step "Voice-over + timing"
$VS validate "$spec" --resolve

step "Stills + contact sheets (look at these)"
$VS stills "$spec" ${variant:+-v "${variant%%,*}"}

step "Layout lint"
set +e; $VS lint "$spec" ${vopt[@]+"${vopt[@]}"}; rc=$?; set -e
[ $rc -eq 1 ] && die "lint errors: fix the spec (see above)"
[ $rc -eq 2 ] && echo "  warnings above: rendering anyway (fix them for a clean result)"

step "Render"
ropt=(-d "$deliv"); [ -n "$quality" ] && ropt+=(-q "$quality"); [ -n "$grain" ] && ropt+=(--grain)
$VS render "$spec" ${vopt[@]+"${vopt[@]}"} "${ropt[@]}"

step "Done in $(( $(date +%s) - t0 )) s"
echo "  outputs:  $spec_dir/out/<variant>/"
echo "  sheets:   $spec_dir/out/stills/*-sheet.jpg"
for d in "$spec_dir"/out/*/; do
  [ "$(basename "$d")" = stills ] && continue
  f=$(ls "$d"*_master.mp4 2>/dev/null || ls "$d"*.mp4 2>/dev/null | head -1)
  [ -n "$f" ] && echo "  video:    $f"
done
[ -n "$open_out" ] && [ "$(uname)" = Darwin ] && open "$spec_dir/out"
exit 0
