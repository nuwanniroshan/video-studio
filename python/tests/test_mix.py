import hashlib
import json
import subprocess
import sys
import time

import numpy as np
import pytest
import soundfile as sf

from conftest import ROOT, make_job
from vsaudio.mix import limiter, run_mix

PRESETS = [("uplifting-tech", 96), ("calm-explainer", 84)]
TIMINGS = {}


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


@pytest.fixture(scope="module")
def renders(tmp_path_factory, vo_lines):
    out = {}
    for name, bpm in PRESETS:
        res = []
        for k in range(2):
            d = tmp_path_factory.mktemp(f"{name}-{k}")
            job = make_job(d, name, bpm, vo_lines)
            t = time.time()
            rep = run_mix(job)
            TIMINGS[f"{name}#{k}"] = time.time() - t
            res.append((job, rep))
        out[name] = res
    return out


@pytest.mark.parametrize("name", [p for p, _ in PRESETS])
def test_loudness_and_peak(renders, name):
    job, rep = renders[name][0]
    print(name, json.dumps(rep), f"{TIMINGS[name + '#0']:.1f}s")
    assert abs(rep["lufs"] - (-16)) <= 1.0
    assert rep["peakDb"] <= -1.0 + 1e-3
    assert rep["truePeakDb"] <= -1.0 + 1e-3, rep["truePeakDb"]
    x, sr = sf.read(job["out"]["mix"], always_2d=True)
    assert sr == 48000 and x.shape == (20 * 48000, 2)
    assert sf.info(job["out"]["mix"]).subtype == "PCM_24"
    assert 20 * np.log10(np.abs(x).max()) <= -0.999
    for stem in job["out"]["stems"].values():
        info = sf.info(stem)
        assert info.samplerate == 48000 and info.channels == 2 and info.subtype == "PCM_24"
    assert rep["warnings"] == []
    for bus, g in rep["busGainsDb"].items():
        assert g is not None, bus


@pytest.mark.parametrize("name", [p for p, _ in PRESETS])
def test_determinism(renders, name):
    (j1, _), (j2, _) = renders[name]
    assert sha(j1["out"]["mix"]) == sha(j2["out"]["mix"])
    for k in ("music", "sfx", "vo"):
        assert sha(j1["out"]["stems"][k]) == sha(j2["out"]["stems"][k])


@pytest.mark.parametrize("name", [p for p, _ in PRESETS])
def test_duck_depth(renders, name):
    _, rep = renders[name][0]
    assert 5.0 <= rep["duckDepthDb"] <= 8.0
    assert 6.0 <= rep["musicUnderVoDb"] <= 16.0


def test_stems_sum_close_to_mix(renders):
    job, rep = renders["uplifting-tech"][0]
    mix, _ = sf.read(job["out"]["mix"])
    s = sum(sf.read(p)[0] for p in job["out"]["stems"].values())
    # stems are pre-glue/pre-limiter at the same gain; they should track the mix closely
    a, b = mix[: -48000 * 2], s[: -48000 * 2]
    corr = np.corrcoef(a.ravel(), b.ravel())[0, 1]
    assert corr > 0.97


def test_no_music_no_vo_and_unknown_marker(tmp_path):
    job = {"duration": 6.0, "seed": 3, "loudness": -16, "music": {"mode": "none"}, "scenes": [],
           "markers": [{"kind": "whoosh", "t": 1.0}, {"kind": "chime", "t": 2.0}, {"kind": "laser", "t": 2.5},
                       {"kind": "final", "t": 4.0}],
           "vo": [], "out": {"mix": str(tmp_path / "m.wav"), "stems": {}}}
    rep = run_mix(job)
    assert abs(rep["lufs"] + 16) <= 1.0 and rep["peakDb"] <= -1.0 + 1e-3
    assert rep["duckDepthDb"] is None
    assert any("laser" in w for w in rep["warnings"])


def test_limiter_never_exceeds_ceiling():
    rng = np.random.default_rng(1)
    x = rng.standard_normal((48000, 2)) * 0.3
    x[1000:1010] = 3.0
    y = limiter(x, -1.0)
    assert np.abs(y).max() <= 10 ** (-1 / 20) + 1e-9


def test_cli_and_ffmpeg_crosscheck(renders, tmp_path):
    job, rep = renders["uplifting-tech"][0]
    job = json.loads(json.dumps(job))
    job["out"] = {"mix": str(tmp_path / "mix.wav"), "stems": {}}
    (tmp_path / "in.json").write_text(json.dumps(job))
    env = {"PYTHONPATH": str(ROOT / "python"), "PATH": "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin"}
    subprocess.run([sys.executable, "-m", "vsaudio", "mix", str(tmp_path / "in.json"), str(tmp_path / "out.json")],
                   check=True, env=env, cwd=ROOT)
    cli = json.loads((tmp_path / "out.json").read_text())
    assert cli["lufs"] == rep["lufs"]
    assert sha(job["out"]["mix"]) == sha(renders["uplifting-tech"][0][0]["out"]["mix"])
    import shutil
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", job["out"]["mix"], "-af", "ebur128=peak=true",
                        "-f", "null", "-"], capture_output=True, text=True)
    summ = p.stderr[p.stderr.rfind("Summary:"):]
    i_lufs = float(summ.split("I:")[1].split("LUFS")[0])
    print("ffmpeg I:", i_lufs, "pyloudnorm:", rep["lufs"])
    assert abs(i_lufs - rep["lufs"]) <= 0.5
