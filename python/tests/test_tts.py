import json
import subprocess
import sys
import time

import soundfile as sf

import vsaudio.tts as tts
from conftest import DICT, MODELS, ROOT, needs_kokoro


def test_dictionary_splice_and_longest_match():
    ph, used = tts.to_phonemes("Meet LuraPlus.", DICT)
    assert ph == "mˈiːt lˈuːɹə plˈʌs."
    assert used == ["LuraPlus"]
    ph, used = tts.to_phonemes("Lura helps.", DICT)
    assert ph.startswith("lˈuːɹə ") and used == ["Lura"]
    ph, used = tts.to_phonemes("LuraPlus's team uses Lura on SaaS.", DICT)
    assert ph.startswith("lˈuːɹə plˈʌsɪz ")
    assert "lˈʊɹɹə" not in ph and "sˈæs" in ph
    assert used == ["LuraPlus", "Lura", "SaaS"]
    # whole words and case-sensitive
    assert tts.find_terms("Luras lura LuraPluses", DICT) == []


@needs_kokoro
def test_tts_synth_cache_and_trim(tmp_path):
    job = {"cacheDir": str(tmp_path / "vo"), "modelsDir": str(MODELS), "voice": "af_heart", "speed": 0.94,
           "lang": "en-us", "dictionary": DICT,
           "lines": [{"id": "hook.v1", "text": "Meet LuraPlus.", "phonemes": None},
                     {"id": "plain", "text": "Run payroll in minutes, not days.", "phonemes": None},
                     {"id": "explicit", "text": "Meet Lura Plus.", "phonemes": "mˈiːt lˈuːɹə plˈʌs."}]}
    t = time.time()
    out = tts.run_tts(job)
    print(f"tts first call (incl. model load): {time.time() - t:.2f}s for 3 lines")
    assert out["modelVersion"] == "kokoro-v1.0"
    a, plain, ex = out["lines"]
    assert not a["cached"] and a["phonemes"] == "mˈiːt lˈuːɹə plˈʌs." and a["dictTerms"] == ["LuraPlus"]
    assert ex["phonemes"] == "mˈiːt lˈuːɹə plˈʌs." and ex["dictTerms"] == []
    # REFERENCE §5.6: "Meet LuraPlus." measured 1.16 s at speed 0.94
    assert 0.9 <= a["dur"] <= 1.5, a["dur"]
    assert 1.4 <= plain["dur"] <= 3.0, plain["dur"]
    x, sr = sf.read(a["wav"])
    assert sr == 24000 and x.ndim == 1 and sf.info(a["wav"]).subtype == "FLOAT"
    assert abs(len(x) / sr - a["dur"]) < 0.002
    # silence trimmed: 40 ms pre / 80 ms post pad, so the edges are near-silent but short
    assert abs(x[:int(0.01 * sr)]).max() < 0.05

    # second call: same input -> cache hit, no model load
    tts._kokoro = None
    tts._tokenizer = None
    tts.stats.update(model_loads=0, synth=0, hits=0)
    out2 = tts.run_tts(job)
    assert all(l["cached"] for l in out2["lines"])
    assert tts._kokoro is None and tts._tokenizer is None and tts.stats["model_loads"] == 0
    assert [l["wav"] for l in out2["lines"]] == [l["wav"] for l in out["lines"]]
    assert out2["lines"][0]["phonemes"] == a["phonemes"]

    # changing a used dictionary entry invalidates; an unused one does not
    d2 = {**DICT, "SaaS": {"respell": "saas"}}
    assert tts.run_tts({**job, "dictionary": d2})["lines"][0]["cached"]
    d3 = {**DICT, "LuraPlus": {"ipa": "lˈuːɹə plˈʌs plˈʌs"}}
    assert tts.find_terms("Meet LuraPlus.", d3) == ["LuraPlus"]


@needs_kokoro
def test_tts_cli_cache_hit_fast(tmp_path):
    job = {"cacheDir": str(tmp_path / "vo"), "modelsDir": str(MODELS), "dictionary": DICT,
           "lines": [{"id": "x", "text": "Meet LuraPlus.", "phonemes": None}]}
    (tmp_path / "in.json").write_text(json.dumps(job, ensure_ascii=False))
    env = {"PYTHONPATH": str(ROOT / "python"), "PATH": "/usr/bin:/bin:/opt/homebrew/bin"}
    cmd = [sys.executable, "-m", "vsaudio", "tts", str(tmp_path / "in.json"), str(tmp_path / "out.json")]
    subprocess.run(cmd, check=True, env=env)
    assert not json.loads((tmp_path / "out.json").read_text())["lines"][0]["cached"]
    t = time.time()
    subprocess.run(cmd, check=True, env=env)
    dt = time.time() - t
    o = json.loads((tmp_path / "out.json").read_text())
    assert o["lines"][0]["cached"] and o["lines"][0]["phonemes"] == "mˈiːt lˈuːɹə plˈʌs."
    print(f"cached CLI call: {dt:.2f}s")
    assert dt < 3.0  # loading the 325 MB model alone takes longer
