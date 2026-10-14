"""Synthesised instruments (REFERENCE §6.2), ported from the prototype. No samples.

Every function that uses noise or random phases takes an explicit numpy Generator.
"""
from __future__ import annotations

import numpy as np

from .dsp import SR, bp, env_adsr, hp, hz, lp, saw, sweep_lp


def pad(rng, notes, dur, cutoff=1800, attack=0.9, release=2.2, detune=0.08, bright_to=None):
    """3 detuned saws per note (-9/0/+9 cents, panned -.8/0/.8) + sub-octave sine; LP; ADSR."""
    n = int((dur + release) * SR)
    out = np.zeros((n, 2))
    tt = np.arange(n) / SR
    for nm in notes:
        f = hz(nm)
        for cents, pan in [(-9, -0.8), (0, 0), (9, 0.8)]:
            ff = f * 2 ** ((cents * (1 + detune)) / 1200)
            x = saw(ff, n, phase=rng.uniform(0, 6.28)) * 0.33
            x += np.sin(2 * np.pi * ff / 2 * tt) * 0.12  # warmth
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            out[:, 0] += x * l
            out[:, 1] += x * r
    out /= len(notes) * 1.6
    out = sweep_lp(out, cutoff, bright_to) if bright_to else lp(out, cutoff)
    e = env_adsr(n, attack, 0.5, 0.85, release, dur)
    return out * e[:, None]


def ks(rng, f, dur, damp=0.996, bright=0.6):
    """Karplus-Strong pluck, pitch-corrected by resampling (REFERENCE §6.2).

    The loop delay is the integer P = round(SR/f) plus the half-sample group delay of the
    two-point averaging filter, so the string really sounds at SR/(P + 0.5). The output is
    resampled by f/(SR/(P + 0.5)) to land on f. (The prototype corrected by SR/P, which left
    upper notes flat instead of sharp, e.g. E6 by ~24 cents.)"""
    P = max(2, int(round(SR / f)))
    fa = SR / (P + 0.5)  # the two-point average adds half a sample: true period is P + 0.5
    n = int(dur * SR * f / fa) + P + 2
    y = np.zeros(n)
    exc = rng.uniform(-1, 1, P)
    exc = bright * exc + (1 - bright) * np.convolve(exc, np.ones(4) / 4, "same")
    y[:P] = exc
    for s in range(P, n, P):
        e = min(n, s + P)
        a = y[s - P:e - P]
        b = np.concatenate([[y[s - P - 1] if s - P - 1 >= 0 else 0.0], y[s - P:e - P - 1]])
        y[s:e] = damp * 0.5 * (a + b)
    m = int(dur * SR)
    src = np.arange(m) * (f / fa)
    out = np.interp(src, np.arange(n), y)
    fade = np.minimum(1, np.linspace(0, 40, m))[::-1]  # last 1/40 of the note fades out
    return out * fade


def bell(f, dur=1.6, ratio=3.5, index=2.2, decay=0.6):
    """2-op FM bell; modulation index decays with tau = 0.35 * decay."""
    t = np.arange(int(dur * SR)) / SR
    ix = index * np.exp(-t / (decay * 0.35))
    x = np.sin(2 * np.pi * f * t + ix * np.sin(2 * np.pi * f * ratio * t))
    return x * np.exp(-t / decay) * np.minimum(1, t / 0.002)


def kick(rng, gain=1.0):
    t = np.arange(int(0.5 * SR)) / SR
    fr = 46 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    x = np.sin(ph) * np.exp(-t / 0.22)
    x += 0.25 * hp(rng.uniform(-1, 1, len(t)), 3000) * np.exp(-t / 0.004)
    return np.tanh(1.6 * x) * gain


def clap(rng):
    t = np.arange(int(0.35 * SR)) / SR
    nz = bp(rng.uniform(-1, 1, len(t)), 900, 3200)
    e = np.zeros(len(t))
    for k, o in enumerate([0, 0.011, 0.022]):
        m = t >= o
        e[m] += np.exp(-(t[m] - o) / (0.006 if k < 2 else 0.12))
    return nz * e * 0.9


def hat(rng, open_=False):
    d = 0.18 if open_ else 0.045
    t = np.arange(int((d * 4) * SR)) / SR
    x = hp(rng.uniform(-1, 1, len(t)), 7500, 4)
    return x * np.exp(-t / d) * 0.5


def tick(rng, hi=True):
    """Clock tick-tock: 2.6 / 1.9 kHz alternating, tau 6 ms."""
    t = np.arange(int(0.05 * SR)) / SR
    f = 2600 if hi else 1900
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006)
    x += 0.4 * hp(rng.uniform(-1, 1, len(t)), 5000) * np.exp(-t / 0.002)
    return x


def sub_pulse(f, dur=0.5):
    ts = np.arange(int(dur * SR)) / SR
    return np.sin(2 * np.pi * f * ts) * np.exp(-ts / 0.22) * np.minimum(1, ts / 0.01)


def bass_note(f, dur):
    n = int((dur + 0.05) * SR)
    t = np.arange(n) / SR
    x = 0.6 * saw(f, n) + 0.8 * np.sin(2 * np.pi * f * t)
    x = lp(x, 420)
    e = np.minimum(1, t / 0.006) * np.exp(-t / (dur * 0.9))
    return np.tanh(1.3 * x * e)
