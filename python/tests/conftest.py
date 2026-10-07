import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

MODELS = Path(os.environ.get("VS_MODELS", ROOT / "models"))
HAVE_KOKORO = (MODELS / "kokoro-v1.0.onnx").exists() and (MODELS / "voices-v1.0.bin").exists()

DICT = {
    "Lura": {"ipa": "lˈuːɹə"},
    "LuraPlus": {"ipa": "lˈuːɹə plˈʌs"},
    "SaaS": {"respell": "sass"},
}

needs_kokoro = pytest.mark.skipif(not HAVE_KOKORO, reason="Kokoro models not found in models/")


@pytest.fixture(scope="session")
def tts_cache(tmp_path_factory):
    return tmp_path_factory.mktemp("vo-cache")


@pytest.fixture(scope="session")
def vo_lines(tts_cache):
    """Two real Kokoro lines for the mix tests (synthetic speech-like fallback without models)."""
    if HAVE_KOKORO:
        from vsaudio.tts import run_tts
        out = run_tts({"cacheDir": str(tts_cache), "modelsDir": str(MODELS), "voice": "af_heart", "speed": 0.94,
                       "lang": "en-us", "dictionary": DICT,
                       "lines": [{"id": "a", "text": "Meet LuraPlus.", "phonemes": None},
                                 {"id": "b", "text": "Run payroll, leave and reviews from one calm place.",
                                  "phonemes": None}]})
        return out["lines"]
    import numpy as np
    import soundfile as sf
    rng = np.random.default_rng(0)
    lines = []
    for i, d in enumerate((1.2, 3.5)):
        t = np.arange(int(d * 24000)) / 24000
        syl = 0.5 + 0.5 * np.sin(2 * np.pi * 4 * t) ** 2
        x = (np.sin(2 * np.pi * 180 * t) + 0.5 * np.sin(2 * np.pi * 360 * t) + 0.1 * rng.standard_normal(len(t))) * syl
        p = tts_cache / f"syn{i}.wav"
        sf.write(p, (0.3 * x).astype(np.float32), 24000)
        lines.append({"id": f"s{i}", "wav": str(p), "dur": d})
    return lines


def make_job(out_dir: Path, preset: str, bpm: float, vo_lines, duration=20.0, seed=1):
    """20 s synthetic job: tension -> reveal (flash) -> groove -> resolve (iris), final marker.
    Scenes sit on the preset's bar grid, as the timing resolver snaps them."""
    bar = 240.0 / bpm
    plan = [("hook", "tension", 0, 2, None), ("logo", "reveal", 2, 4, "flash"),
            ("feat", "groove", 4, 6, "crossfade"), ("cta", "resolve", 6, 99, "iris")]
    scenes = []
    for sid, cue, b0, b1, tr in plan:
        s, e = b0 * bar, min(duration, b1 * bar)
        if s >= duration:
            break
        scenes.append({"id": sid, "start": s, "end": e, "musicCue": cue,
                       "transitionIn": None if tr is None else {"type": tr, "start": s - 0.45, "end": s + 0.45}})
    markers = [{"kind": "whoosh", "t": 2 * bar - 0.44, "gain": 1.0, "pan": 0.0}, {"kind": "pop", "t": 3.0},
               {"kind": "type", "t": 7.0}, {"kind": "click", "t": 7.4, "pan": 0.3}, {"kind": "chime", "t": 12.0},
               {"kind": "sparkle", "t": 2 * bar + 0.3}, {"kind": "impact", "t": 4 * bar}, {"kind": "final", "t": duration - 2.2}]
    return {
        "duration": duration, "seed": seed, "loudness": -16,
        "music": {"mode": "preset", "preset": preset, "bpm": bpm},
        "scenes": scenes, "markers": markers,
        "vo": [{"id": vo_lines[0]["id"], "t": 1.0, "wav": vo_lines[0]["wav"]},
               {"id": vo_lines[1]["id"], "t": 4 * bar + 0.3, "wav": vo_lines[1]["wav"]}],
        "out": {"mix": str(out_dir / "mix.wav"),
                "stems": {k: str(out_dir / f"{k}.wav") for k in ("music", "sfx", "vo")}},
    }
