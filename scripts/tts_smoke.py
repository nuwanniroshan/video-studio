"""M0 toolchain smoke test: Kokoro TTS via system espeak-ng, phoneme override, Whisper round-trip.

    ./.venv/bin/python scripts/tts_smoke.py out/spike/tts
"""
import os, sys, time, json
import numpy as np, soundfile as sf
from scipy.signal import resample_poly

ESPEAK_LIB = os.environ.get("ESPEAK_LIB", "/opt/homebrew/lib/libespeak-ng.dylib")
ESPEAK_DATA = os.environ.get("ESPEAK_DATA", "/opt/homebrew/share/espeak-ng-data")
MODELS = os.environ.get("VS_MODELS", os.path.join(os.path.dirname(__file__), "..", "models"))

from kokoro_onnx import Kokoro, EspeakConfig

out = sys.argv[1] if len(sys.argv) > 1 else "out/spike/tts"
os.makedirs(out, exist_ok=True)
t0 = time.time()
k = Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"), os.path.join(MODELS, "voices-v1.0.bin"),
           espeak_config=EspeakConfig(lib_path=ESPEAK_LIB, data_path=ESPEAK_DATA))
res = {"load_s": round(time.time() - t0, 2)}
res["espeak_lura"] = k.tokenizer.phonemize("Meet Lura Plus.", "en-us")
lines = {
    "plain": ("Run payroll in minutes, not days.", False),
    "override": ("mˈiːt lˈuːɹə plˈʌs.", True),
}
for name, (text, is_ph) in lines.items():
    t = time.time()
    audio, sr = k.create(text, voice="af_heart", speed=0.94, lang="en-us", is_phonemes=is_ph)
    sf.write(os.path.join(out, f"{name}.wav"), audio, sr)
    res[name] = {"sr": sr, "dur": round(len(audio) / sr, 2), "synth_s": round(time.time() - t, 2)}

from faster_whisper import WhisperModel
t = time.time()
wm = WhisperModel("small.en", device="cpu", compute_type="int8")
x, sr = sf.read(os.path.join(out, "plain.wav"), dtype="float32")
x16 = resample_poly(x, 2, 3).astype(np.float32)  # 24k → 16k; avoids the PyAV metadata_errors bug
segs, _ = wm.transcribe(x16, beam_size=5, word_timestamps=True, language="en")
res["whisper"] = {"text": " ".join(s.text.strip() for s in segs), "s": round(time.time() - t, 1)}
print(json.dumps(res, ensure_ascii=False, indent=1))
