# Idempotent setup shared by make-video.sh and studio.sh: installs only what's missing.
# Usage: source scripts/lib/setup.sh && vs_setup   (from the repo root)
vs_setup() {
  die() { printf "\033[1;31m✗ %s\033[0m\n" "$1"; exit 1; }
  command -v node >/dev/null || die "Node 20+ is required (https://nodejs.org or nvm)"
  command -v pnpm >/dev/null || die "pnpm is required: npm install -g pnpm"
  if [ "$(uname)" = Darwin ]; then
    for b in ffmpeg espeak-ng; do
      command -v $b >/dev/null || { command -v brew >/dev/null || die "$b missing and Homebrew not found"; echo "  installing $b"; brew install $b; }
    done
  else
    for b in ffmpeg espeak-ng; do command -v $b >/dev/null || die "$b missing: apt-get install ffmpeg espeak-ng"; done
  fi
  [ -d node_modules ] || { echo "  pnpm install"; pnpm install; }
  # Playwright Chromium (headless shell) for the version this repo uses
  if ! (cd packages/render && node -e "const {chromium}=require('playwright');require('fs').accessSync(chromium.executablePath())" 2>/dev/null); then
    echo "  installing Playwright Chromium"; pnpm --filter @vs/render exec playwright install chromium
  fi
  [ -x .venv/bin/python ] && [ -f models/kokoro-v1.0.onnx ] && [ -f models/voices-v1.0.bin ] || { echo "  Python audio toolchain + Kokoro models (~350 MB, once)"; scripts/setup-python.sh; }
  [ -f packages/runtime/dist/runtime.js ] || { echo "  building the runtime"; (cd packages/runtime && node build.mjs); }
  echo "  ok"
}
