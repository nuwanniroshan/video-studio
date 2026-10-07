import time

from conftest import DICT, MODELS, needs_kokoro
from vsaudio.qa import run_qa, score_line


def test_score_excludes_dictionary_terms():
    s, missing, extra = score_line("Meet LuraPlus, run your whole business.", "Meet Laura Plus, run your whole business.", DICT)
    assert s == 1.0 and missing == []
    assert extra == ["laura"]
    s, missing, _ = score_line("Run payroll in minutes, not days.", "Run payroll in minutes.", DICT)
    assert missing == ["not", "days"] and abs(s - 4 / 6) < 1e-3


@needs_kokoro
def test_qa_on_real_kokoro_line(tmp_path):
    from vsaudio.tts import run_tts
    text = "Meet LuraPlus, one platform for your whole team."
    tts = run_tts({"cacheDir": str(tmp_path), "modelsDir": str(MODELS), "dictionary": DICT,
                   "lines": [{"id": "l1", "text": text, "phonemes": None}]})
    t = time.time()
    out = run_qa({"model": "small.en", "dictionary": DICT,
                  "lines": [{"id": "l1", "text": text, "wav": tts["lines"][0]["wav"]}]})
    line = out["lines"][0]
    print(f"qa {time.time() - t:.1f}s heard={line['heard']!r} score={line['score']} extra={line['extra']}")
    assert line["ignored"] == ["LuraPlus"]
    assert line["score"] >= 0.8
    assert out["ok"]
