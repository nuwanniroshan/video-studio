"""Whisper QA for VO lines (REFERENCE §5.5).

faster-whisper small.en, int8, CPU, beam 5, word timestamps. Audio is passed as a float32
16 kHz numpy array (not a path: PyAV metadata_errors bug, REFERENCE §5.2). Dictionary terms
and their parts are excluded from scoring because Whisper mishears invented brand names.
score = matched non-dictionary words / non-dictionary words; ok = every score >= 0.8.
"""
from __future__ import annotations

import difflib
import re
from math import gcd

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

PASS = 0.8
_models = {}


def get_model(name="small.en"):
    if name not in _models:
        from faster_whisper import WhisperModel
        _models[name] = WhisperModel(name, device="cpu", compute_type="int8")
    return _models[name]


def norm_words(text: str) -> list[str]:
    text = text.replace("’", "'").lower()
    text = re.sub(r"[-–—/]", " ", text)
    words = []
    for w in text.split():
        w = re.sub(r"'s$", "", w)
        w = re.sub(r"[^\w]", "", w)
        if w:
            words.append(w)
    return words


def dict_parts(dictionary: dict) -> set[str]:
    """Normalised forms of every term, its CamelCase/space parts and its respelling."""
    parts = set()
    for term, entry in (dictionary or {}).items():
        pieces = [term] + re.findall(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+", term) + term.split()
        if isinstance(entry, dict) and entry.get("respell"):
            pieces += [entry["respell"]] + entry["respell"].split()
        for p in pieces:
            parts.update(norm_words(p))
            parts.add(re.sub(r"[^\w]", "", p.lower()))
    parts.discard("")
    return parts


def load_16k(path) -> np.ndarray:
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    if sr != 16000:
        g = gcd(int(sr), 16000)
        x = resample_poly(x, 16000 // g, int(sr) // g)
    return x.astype(np.float32)


def score_line(text, heard, dictionary):
    parts = dict_parts(dictionary)
    exp = [w for w in norm_words(text) if w not in parts]
    got = [w for w in norm_words(heard) if w not in parts]
    sm = difflib.SequenceMatcher(a=exp, b=got, autojunk=False)
    matched_a, matched_b = set(), set()
    for blk in sm.get_matching_blocks():
        matched_a.update(range(blk.a, blk.a + blk.size))
        matched_b.update(range(blk.b, blk.b + blk.size))
    missing = [w for i, w in enumerate(exp) if i not in matched_a]
    extra = [w for i, w in enumerate(got) if i not in matched_b]
    score = len(matched_a) / len(exp) if exp else 1.0
    return round(score, 3), missing, extra


def run_qa(job: dict) -> dict:
    dictionary = job.get("dictionary") or {}
    model = get_model(job.get("model", "small.en"))
    from ..tts import find_terms
    out = []
    for line in job.get("lines") or []:
        x = load_16k(line["wav"])
        segs, _ = model.transcribe(x, beam_size=5, word_timestamps=True, language="en")
        segs = list(segs)
        heard = " ".join(s.text.strip() for s in segs).strip()
        words = [{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
                 for s in segs for w in (s.words or [])]
        score, missing, extra = score_line(line.get("text", ""), heard, dictionary)
        out.append({"id": line["id"], "heard": heard, "score": score, "missing": missing, "extra": extra,
                    "ignored": find_terms(line.get("text", "").replace("’", "'"), dictionary),
                    "words": words})
    return {"ok": all(l["score"] >= PASS for l in out), "lines": out}
