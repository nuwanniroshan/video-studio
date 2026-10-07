#!/usr/bin/env bash
# Recreates the audio toolchain (REFERENCE §5.1, §8). macOS: `brew install espeak-ng ffmpeg` first.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
# kokoro-onnx pulls upstream phonemizer, whose 3.4 regression breaks system espeak-ng: swap in phonemizer-fork.
grep -v phonemizer-fork python/requirements.lock > /tmp/vs-req.txt
./.venv/bin/pip install -q -r /tmp/vs-req.txt
./.venv/bin/pip uninstall -y -q phonemizer || true
./.venv/bin/pip install -q --no-deps "$(grep phonemizer-fork python/requirements.lock)"
mkdir -p models && cd models
base=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -f kokoro-v1.0.onnx ] || curl -sSLO $base/kokoro-v1.0.onnx   # 325 MB, Apache-2.0
[ -f voices-v1.0.bin ]  || curl -sSLO $base/voices-v1.0.bin    # 28 MB
echo "audio toolchain ready"
