"""Final mix (REFERENCE §5.3 VO chain, §6.4 mix): music + SFX + VO -> loudness-normalised
48 kHz / 24-bit mix and stems, plus a QA report."""
from __future__ import annotations

import math
from math import gcd
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

from ..score.arranger import arrange, load_preset
from ..score.dsp import SR, active_mask, add, bp, buf, hp, lp, reverb, rms_db
from ..score.sfx import render_sfx

# Sample-peak ceiling. Inter-sample peaks run ~0.1–0.3 dB above sample peaks, so −1.3 dBFS keeps
# true peak ≤ −1 dBTP (the distribution target) without an oversampled limiter.
CEILING_DB = -1.3


# ------------------------------------------------------------------ voice
def load_mono(path, sr_out=SR) -> np.ndarray:
    x, sr = sf.read(str(path), dtype="float64", always_2d=True)
    x = x.mean(axis=1)
    if sr != sr_out:
        g = gcd(int(sr), int(sr_out))
        x = signal.resample_poly(x, sr_out // g, int(sr) // g)
    return x


def process_vo_line(x: np.ndarray) -> np.ndarray:
    """HP 85 Hz, +25 % presence (2.5-5 kHz), +12 % air (>8 kHz), soft-knee compression on the
    Hilbert envelope (thr 0.25*max, ~2.5:1), peak-normalise to 0.7."""
    if len(x) == 0 or np.max(np.abs(x)) == 0:
        return x
    x = hp(x, 85)
    x = x + 0.25 * bp(x, 2500, 5000) + 0.12 * hp(x, 8000)
    env = lp(np.abs(signal.hilbert(x)), 20)
    thr = 0.25 * env.max()
    gain = np.where(env > thr, (thr + (env - thr) * 0.4) / np.maximum(env, 1e-9), 1.0)
    x = x * gain
    return x / np.max(np.abs(x)) * 0.7


def build_vo(lines, n, rng):
    out = buf(n)
    for line in lines:
        x = process_vo_line(load_mono(line["wav"]))
        add(out, x, float(line["t"]), 1.0)
    return reverb(out, rng, 0.7, 0.08)


def duck_curve(vo, depth_db=-6.5, att=0.04, rel=0.45, gate=0.02, hop_s=0.01):
    """Gain curve (linear) that dips depth_db while the VO is above the gate."""
    m = np.abs(vo).max(axis=1)
    hop = int(hop_s * SR)
    frames = len(m) // hop + 1
    pad = np.zeros(frames * hop)
    pad[: len(m)] = m
    lvl = pad.reshape(frames, hop).max(axis=1)
    on = (lvl > gate).astype(float)
    g = np.zeros(frames)
    a_c, r_c = math.exp(-hop_s / att), math.exp(-hop_s / rel)
    prev = 0.0
    for i in range(frames):
        c = a_c if on[i] > prev else r_c
        prev = c * prev + (1 - c) * on[i]
        g[i] = prev
    curve = 10 ** (depth_db * g / 20)
    return np.interp(np.arange(len(m)), np.arange(frames) * hop, curve)


# ------------------------------------------------------------------ mastering
def limiter(x, ceiling_db=CEILING_DB, attack=0.005, release=0.08, block=64):
    """Look-ahead gain-envelope peak limiter (no clipping). The required gain is held per block,
    released with a one-pole (`release` s), then a min-filter + moving average of `attack` s
    (look-ahead) smooths the onset; the result never exceeds the required gain."""
    c = 10 ** (ceiling_db / 20)
    peak = np.abs(x).max(axis=1)
    req = np.minimum(1.0, c / np.maximum(peak, 1e-12))
    if req.min() >= 1.0:
        return x.copy()
    n = len(req)
    nb = -(-n // block)
    padded = np.ones(nb * block)
    padded[:n] = req
    breq = padded.reshape(nb, block).min(axis=1)
    rc = math.exp(-block / SR / release)
    g = np.empty(nb)
    s = 1.0
    for i in range(nb):
        r = breq[i]
        s = r if r < s else r + (s - r) * rc
        g[i] = s
    gs = np.repeat(g, block)[:n]
    w = max(1, int(attack * SR))
    # min over [i, i+w) (look-ahead), then average over (i-w, i] -> <= req everywhere
    gmin = minimum_filter1d(gs, size=w, origin=-(w // 2), mode="nearest")
    gsm = uniform_filter1d(gmin, size=w, origin=(w - 1) // 2, mode="nearest")
    gsm = np.minimum(gsm, gs)
    return x * gsm[:, None]


def true_peak_db(x) -> float:
    up = signal.resample_poly(x, 4, 1, axis=0)
    return float(20 * np.log10(np.abs(up).max() + 1e-12))


def peak_db(x) -> float:
    return float(20 * np.log10(np.abs(x).max() + 1e-12))


def lra(meter_rate, x) -> float | None:
    """EBU R128 loudness range (3 s windows, 1 s hop, gated, 10th-95th percentile)."""
    meter = pyln.Meter(meter_rate, block_size=3.0)
    win, hop = int(3 * meter_rate), int(1 * meter_rate)
    vals = []
    for a in range(0, max(0, len(x) - win) + 1, hop):
        seg = x[a:a + win]
        if len(seg) < win:
            break
        with np.errstate(divide="ignore"):
            v = meter.integrated_loudness(seg)
        if np.isfinite(v):
            vals.append(v)
    vals = np.array([v for v in vals if v > -70])
    if len(vals) < 2:
        return None
    rel = 10 * np.log10(np.mean(10 ** (vals / 10))) - 20
    vals = vals[vals > rel]
    if len(vals) < 2:
        return None
    return float(np.percentile(vals, 95) - np.percentile(vals, 10))


def loudness(meter, x) -> float:
    with np.errstate(divide="ignore"):
        v = meter.integrated_loudness(x)
    return float(v)


def master(mix, target, meter, rounds=4, tol=0.3):
    """Gain to the loudness target, peak-limit to the ceiling, re-measure; repeat up to `rounds`."""
    lufs = loudness(meter, mix)
    total_gain = 1.0
    if not np.isfinite(lufs):
        return mix, lufs, 1.0
    out = mix
    for _ in range(rounds):
        total_gain *= 10 ** ((target - lufs) / 20)
        out = limiter(mix * total_gain)
        lufs = loudness(meter, out)
        if abs(lufs - target) <= tol:
            break
    return out, lufs, total_gain


def r(v, nd=2):
    return None if v is None or not np.isfinite(v) else round(float(v), nd)


# ------------------------------------------------------------------ job
def run_mix(job: dict) -> dict:
    duration = float(job["duration"])
    seed = int(job.get("seed", 1))
    target = float(job.get("loudness", -16))
    n = int(round(duration * SR))
    scenes = job.get("scenes") or []
    markers = job.get("markers") or []
    warnings = []

    music_cfg = job.get("music") or {"mode": "none"}
    mode = music_cfg.get("mode", "preset")
    music = None
    gains = {}
    region = None
    if mode == "preset":
        preset = load_preset(music_cfg.get("preset", "uplifting-tech"))
        music, info = arrange(preset, scenes, markers, duration, seed, music_cfg.get("bpm"))
        gains = info["busGainsDb"]
        region = info["region"]
        warnings += info["warnings"]
    elif mode != "none":
        warnings.append(f"music mode '{mode}' not supported here; no music bus")

    fx, w = render_sfx(markers, n, np.random.default_rng([seed, 2]), final_hit=music is None)
    warnings += w
    vo = build_vo(job.get("vo") or [], n, np.random.default_rng([seed, 3]))

    vo_act = active_mask(vo, 0.02)
    has_vo = bool(vo_act.any())
    fx_act = active_mask(fx, 1e-3)
    has_music = music is not None and active_mask(music, 1e-4).any()
    if has_vo:
        vo_rms = rms_db(vo[vo_act])
        ref_music = vo_rms - 5
        ref_fx = vo_rms - 9
    else:
        vo_rms = None
        ref_music = -21.0  # arbitrary; loudness normalisation sets the final level
        ref_fx = ref_music - 4
    if has_music:
        music = music * 10 ** ((ref_music - rms_db(music[region])) / 20)
    else:
        music = buf(n)
    if fx_act.any():
        fx = fx * 10 ** ((ref_fx - rms_db(fx[fx_act])) / 20)

    duck = duck_curve(vo, -6.5) if has_vo else np.ones(n)
    music_d = music * duck[:, None]
    fx_d = fx * (0.5 + 0.5 * duck)[:, None]

    mix = music_d + fx_d + vo
    mix = np.tanh(mix * 1.1) / 1.1
    tail = min(n, int(1.2 * SR))
    if tail:
        mix[-tail:] *= (np.linspace(1, 0, tail) ** 2)[:, None]

    meter = pyln.Meter(SR)
    out, lufs, g = master(mix, target, meter)
    if not np.isfinite(lufs):
        warnings.append("mix is silent")

    o = job["out"]
    Path(o["mix"]).parent.mkdir(parents=True, exist_ok=True)
    sf.write(o["mix"], out.astype(np.float32), SR, subtype="PCM_24")
    stems = o.get("stems") or {}
    for name, x in (("music", music_d), ("sfx", fx_d), ("vo", vo)):
        if stems.get(name):
            Path(stems[name]).parent.mkdir(parents=True, exist_ok=True)
            sf.write(stems[name], np.clip(x * g, -1, 1).astype(np.float32), SR, subtype="PCM_24")

    # report (measured on what was written: 24-bit quantised)
    written, _ = sf.read(o["mix"], dtype="float64", always_2d=True)
    lufs_w = loudness(meter, written)
    duck_depth = None
    under = None
    if has_vo:
        dd = 20 * np.log10(duck[vo_act])
        duck_depth = -float(np.mean(dd))
        if has_music:
            under = rms_db(vo[vo_act]) - rms_db(music_d[vo_act])
    return {
        "lufs": r(lufs_w),
        "truePeakDb": r(true_peak_db(written)),
        "peakDb": r(peak_db(written)),
        "lra": r(lra(SR, written), 1),
        "voRmsDb": r(rms_db(vo[vo_act] * g) if has_vo else None, 1),
        "musicUnderVoDb": r(under, 1),
        "duckDepthDb": r(duck_depth, 1),
        "busGainsDb": gains,
        "durationSec": r(len(written) / SR, 3),
        "warnings": warnings,
    }
