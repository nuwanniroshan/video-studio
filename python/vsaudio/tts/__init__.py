"""Kokoro TTS with a brand pronunciation dictionary and a content-hash cache (REFERENCE §5).

* G2P is espeak-ng through kokoro-onnx's tokenizer (system espeak via EspeakConfig; the bundled
  espeakng-loader is broken, REFERENCE §5.2). misaki is not used.
* Dictionary terms match whole words, case-sensitively, longest first ("LuraPlus" beats
  "Lura"); a possessive ("LuraPlus's") still matches. `respell` entries are substituted in the
  text before phonemisation; `ipa` entries are spliced verbatim into the phoneme stream.
* Cache: sha256 of (text or explicit phonemes, voice, speed, lang, dictionary entries used, model
  version) -> <cacheDir>/<key>.wav + <key>.json. Hits never touch espeak or the ONNX model.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

import numpy as np
import soundfile as sf

ESPEAK_LIB = os.environ.get("ESPEAK_LIB", "/opt/homebrew/lib/libespeak-ng.dylib")
ESPEAK_DATA = os.environ.get("ESPEAK_DATA", "/opt/homebrew/share/espeak-ng-data")
MODEL_FILE = "kokoro-v1.0.onnx"
VOICES_FILE = "voices-v1.0.bin"
MODEL_VERSION = "kokoro-v1.0"
TTS_SR = 24000

# Placeholder words for IPA splicing: espeak renders them stably (bˈɑːb etc.) and keeps
# sentence context (stress, linking, possessive -z) intact around the spliced term.
_PLACEHOLDERS = [("Bob", "b[ˈˌ]?ɑːb"), ("Zod", "z[ˈˌ]?ɑːd"), ("Tom", "t[ˈˌ]?ɑːm")]

_kokoro = None
_kokoro_key = None
_tokenizer = None
stats = {"model_loads": 0, "synth": 0, "hits": 0}


def _espeak_config():
    from kokoro_onnx import EspeakConfig
    return EspeakConfig(lib_path=ESPEAK_LIB, data_path=ESPEAK_DATA)


def get_tokenizer():
    """espeak G2P only (cheap, no ONNX model)."""
    global _tokenizer
    if _kokoro is not None:
        return _kokoro.tokenizer
    if _tokenizer is None:
        from kokoro_onnx.tokenizer import Tokenizer
        _tokenizer = Tokenizer(_espeak_config())
    return _tokenizer


def get_kokoro(models_dir):
    """Load Kokoro once per process (per models dir)."""
    global _kokoro, _kokoro_key
    key = str(Path(models_dir).resolve())
    if _kokoro is None or _kokoro_key != key:
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro(str(Path(models_dir) / MODEL_FILE), str(Path(models_dir) / VOICES_FILE),
                         espeak_config=_espeak_config())
        _kokoro_key = key
        stats["model_loads"] += 1
    return _kokoro


# ------------------------------------------------------------------ dictionary
def term_regex(dictionary: dict):
    terms = sorted((t for t in dictionary if t), key=lambda t: (-len(t), t))
    if not terms:
        return None
    alt = "|".join(re.escape(t) for t in terms)
    # whole word, case-sensitive; "LuraPlus's" matches LuraPlus (apostrophe isn't \w)
    return re.compile(rf"(?<![\w])(?:{alt})(?![\w])")


def find_terms(text: str, dictionary: dict) -> list[str]:
    rx = term_regex(dictionary or {})
    if not rx:
        return []
    seen = []
    for m in rx.finditer(text):
        if m.group(0) not in seen:
            seen.append(m.group(0))
    return seen


def to_phonemes(text: str, dictionary: dict, lang="en-us") -> tuple[str, list[str]]:
    """Phonemise text with dictionary terms spliced in. Returns (phonemes, terms used)."""
    tk = get_tokenizer()
    text = text.replace("’", "'")
    rx = term_regex(dictionary or {})
    used = []
    if not rx:
        return tk.phonemize(text, lang), used
    ph_name, ph_rx = next(((w, p) for w, p in _PLACEHOLDERS if not re.search(rf"\b{w}\b", text, re.I)),
                          _PLACEHOLDERS[0])
    ipas = []

    def sub(m):
        term = m.group(0)
        entry = dictionary[term]
        if term not in used:
            used.append(term)
        if entry.get("ipa"):
            ipas.append(entry["ipa"])
            return ph_name
        if entry.get("respell"):
            return entry["respell"]
        return term

    swapped = rx.sub(sub, text)
    ph = tk.phonemize(swapped, lang)
    if ipas:
        parts = re.split(ph_rx, ph)
        if len(parts) - 1 == len(ipas):
            out = parts[0]
            for ipa, rest in zip(ipas, parts[1:]):
                out += ipa + _possessive(ipa, rest)
            ph = out
        else:  # fallback: phonemise the chunks between terms separately
            ph = _chunk_splice(text, rx, dictionary, lang)
    return ph, used


def _possessive(ipa: str, rest: str) -> str:
    """The placeholder ends in a voiced stop, so espeak renders its possessive as a bare 'z'.
    Re-derive the English allomorph from the spliced IPA's last sound: ɪz after sibilants,
    s after voiceless consonants, z otherwise."""
    m = re.match(r"z(?=$|[\s.,!?;:])", rest)
    if not m:
        return rest
    last = re.sub(r"[ˈˌː\s]", "", ipa)[-1:]
    if re.search(r"(s|z|ʃ|ʒ|tʃ|dʒ)$", re.sub(r"[ˈˌː\s]", "", ipa)):
        return "ɪz" + rest[1:]
    if last in ("p", "t", "k", "f", "θ"):
        return "s" + rest[1:]
    return rest


def _chunk_splice(text, rx, dictionary, lang):
    tk = get_tokenizer()
    out, pos = [], 0
    for m in rx.finditer(text):
        chunk = text[pos:m.start()]
        if chunk.strip():
            out.append(tk.phonemize(chunk, lang))
        e = dictionary[m.group(0)]
        out.append(e.get("ipa") or tk.phonemize(e.get("respell") or m.group(0), lang).rstrip(".,!?;:"))
        pos = m.end()
    tail = text[pos:]
    if tail.startswith("'s"):
        out[-1] += "z"
        tail = tail[2:]
    if tail.strip():
        t = tk.phonemize(tail, lang)
        out.append(t)
    s = " ".join(out)
    return re.sub(r" ([.,!?;:])", r"\1", s)


# ------------------------------------------------------------------ audio
def trim(x, sr=TTS_SR, thresh_db=-45, pre=0.04, post=0.08):
    """Trim silence at thresh_db re peak; keep `pre` s in front and `post` s behind."""
    env = np.abs(x)
    if env.max() == 0:
        return x
    idx = np.where(env > 10 ** (thresh_db / 20) * env.max())[0]
    a = max(0, idx[0] - int(pre * sr))
    b = min(len(x), idx[-1] + int(post * sr))
    return x[a:b]


def cache_key(text, phonemes, voice, speed, lang, used_entries) -> str:
    payload = json.dumps({"text": text if phonemes is None else None, "phonemes": phonemes, "voice": voice,
                          "speed": round(float(speed), 4), "lang": lang, "dict": used_entries,
                          "model": MODEL_VERSION}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def synth_line(line, *, cache_dir, models_dir, voice="af_heart", speed=0.94, lang="en-us", dictionary=None):
    dictionary = dictionary or {}
    text = line.get("text") or ""
    explicit = line.get("phonemes")
    terms = [] if explicit else find_terms(text.replace("’", "'"), dictionary)
    used_entries = {t: dictionary[t] for t in sorted(terms)}
    key = cache_key(text, explicit, voice, speed, lang, used_entries)
    cdir = Path(cache_dir)
    wav, meta = cdir / f"{key}.wav", cdir / f"{key}.json"
    if wav.exists() and meta.exists():
        m = json.loads(meta.read_text())
        stats["hits"] += 1
        return {"id": line["id"], "wav": str(wav), "dur": m["dur"], "cached": True,
                "phonemes": m.get("phonemes"), "dictTerms": m.get("dictTerms", terms)}

    if explicit:
        ph, used = explicit, []
    else:
        ph, used = to_phonemes(text, dictionary, lang)
    k = get_kokoro(models_dir)
    # Always synthesise from the phonemes we report (identical to Kokoro's own G2P when no
    # term was spliced, and required when one was).
    audio, sr = k.create(ph, voice=voice, speed=float(speed), lang=lang, is_phonemes=True)
    stats["synth"] += 1
    x = trim(np.asarray(audio, dtype=np.float32), sr)
    cdir.mkdir(parents=True, exist_ok=True)
    tmp = wav.with_suffix(".tmp.wav")
    sf.write(str(tmp), x, sr, subtype="FLOAT")
    os.replace(tmp, wav)
    dur = round(len(x) / sr, 3)
    meta.write_text(json.dumps({"dur": dur, "phonemes": ph, "dictTerms": used, "text": text, "voice": voice,
                                "speed": speed, "lang": lang, "model": MODEL_VERSION}, ensure_ascii=False))
    return {"id": line["id"], "wav": str(wav), "dur": dur, "cached": False, "phonemes": ph, "dictTerms": used}


def run_tts(job: dict) -> dict:
    out = []
    for line in job.get("lines") or []:
        out.append(synth_line(line, cache_dir=job["cacheDir"], models_dir=job.get("modelsDir") or "models",
                              voice=job.get("voice", "af_heart"), speed=job.get("speed", 0.94),
                              lang=job.get("lang", "en-us"), dictionary=job.get("dictionary") or {}))
    return {"modelVersion": MODEL_VERSION, "lines": out}
