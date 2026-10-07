"""DSP primitives for the synthesised score (ported from the prototype's audio/score.py).

All buffers are 48 kHz float64; stereo buffers are shaped (n, 2). Nothing here reads
module-level state: buffer lengths and random generators are passed in explicitly so a
render is fully determined by its inputs (REFERENCE §6.1).
"""
from __future__ import annotations

import numpy as np
from scipy import signal

SR = 48000

NOTE = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6,
    "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
}


def hz(name: str) -> float:
    """Note name with octave (e.g. 'F#4', 'Bb2') to frequency in Hz (A4 = 440)."""
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[n] + 12 * (o + 1) - 69) / 12)


def buf(n: int) -> np.ndarray:
    return np.zeros((n, 2), dtype=np.float64)


def pan_gains(pan: float) -> tuple[float, float]:
    """Constant-power pan with sqrt(2) compensation (centre = unity per channel)."""
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return l * np.sqrt(2), r * np.sqrt(2)


def add(dst: np.ndarray, x: np.ndarray, t: float, gain: float = 1.0, pan: float = 0.0) -> None:
    """Mix mono or stereo x into dst at time t (seconds); clipped to dst's length."""
    n = len(dst)
    i = int(round(t * SR))
    if i >= n or len(x) == 0:
        return
    if x.ndim == 1:
        l, r = pan_gains(pan)
        x = np.stack([x * l, x * r], axis=1)
    j = min(n, i + len(x))
    s = max(0, -i)
    if j <= max(i, 0):
        return
    dst[max(i, 0):j] += x[s:j - i] * gain


def lp(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def hp(x, fc, order=2):
    sos = signal.butter(order, fc, "high", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, min(hi, SR * 0.45)], "band", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def sweep_lp(x, f0, f1, block=256):
    """Time-varying low-pass (exponential sweep f0 -> f1) with filter state carried between blocks."""
    out = np.zeros_like(x)
    n = len(x)
    zi = None
    for a in range(0, n, block):
        p = a / max(1, n - 1)
        fc = f0 * (f1 / f0) ** p
        sos = signal.butter(2, min(fc, SR * 0.45), "low", fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2) + x.shape[1:])
        out[a:a + block], zi = signal.sosfilt(sos, x[a:a + block], axis=0, zi=zi)
    return out


def env_adsr(n, a, d, s, r, total):
    """ADSR envelope of n samples; the release starts at `total` seconds."""
    t = np.arange(n) / SR
    e = np.ones(n) * s
    e[t < a] = t[t < a] / a
    m = (t >= a) & (t < a + d)
    e[m] = 1 - (1 - s) * (t[m] - a) / d
    rel = t >= total
    e[rel] = s * np.exp(-(t[rel] - total) / (r / 4))
    return e


def saw(f, n, phase=0.0):
    t = np.arange(n) / SR
    return signal.sawtooth(2 * np.pi * f * t + phase)


def reverb_ir(rng: np.random.Generator, rt=2.6, pre=0.02):
    """Stereo Gaussian-noise IR with exponential decay (RT60 = rt), low-passed at 5.2 kHz."""
    n = int(rt * 1.2 * SR)
    t = np.arange(n) / SR
    e = np.exp(-6.9 * t / rt)
    ir = np.stack([rng.standard_normal(n), rng.standard_normal(n)], 1) * e[:, None]
    ir = lp(ir, 5200)
    ir[: int(pre * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum() / 2)


def reverb(x, rng: np.random.Generator, rt=2.6, mix=0.3):
    ir = reverb_ir(rng, rt)
    wet = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)
    return x * (1 - mix) + wet * mix * 0.35


def delay(x, time, fb=0.35, taps=5, pingpong=True):
    """Ping-pong feedback delay (taps alternate channels)."""
    out = x.copy()
    d = int(time * SR)
    for k in range(1, taps + 1):
        if d * k >= len(x):
            break
        g = fb ** k
        sh = np.zeros_like(x)
        sh[d * k:] = x[: len(x) - d * k]
        if pingpong and k % 2:
            sh = sh[:, ::-1]
        out += sh * g
    return out


def rms_db(x) -> float:
    if x.size == 0:
        return -240.0
    return float(20 * np.log10(np.sqrt(np.mean(np.square(x))) + 1e-12))


def active_mask(x, thr=1e-3) -> np.ndarray:
    """Per-sample mask where the (stereo) signal exceeds thr in either channel."""
    a = np.abs(x)
    return (a.max(axis=1) if a.ndim == 2 else a) > thr
