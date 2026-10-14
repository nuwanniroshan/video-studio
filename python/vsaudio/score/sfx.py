"""Sound-design one-shots (REFERENCE §6.2 "SFX"), ported from the prototype, plus the
marker -> SFX-bus renderer used by the mix."""
from __future__ import annotations

import numpy as np
from scipy import signal

from .dsp import SR, add, bp, buf, hp, hz, lp, reverb
from .instruments import bell


def riser(rng, dur, f0=300, f1=5000, tone=True):
    """Band-passed noise sweeping up (block-wise), shaped by p^2.2, plus a rising sine 110*8^p."""
    n = int(dur * SR)
    if n <= 0:
        return np.zeros(0)
    t = np.arange(n) / SR
    p = t / dur
    nz = rng.uniform(-1, 1, n)
    out = np.zeros(n)
    blk = 1024
    zi = None
    for a in range(0, n, blk):
        fc = f0 * (f1 / f0) ** (a / n)
        sos = signal.butter(2, [fc * 0.7, min(fc * 1.4, SR * 0.45)], "band", fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[a:a + blk], zi = signal.sosfilt(sos, nz[a:a + blk], zi=zi)
    out *= p ** 2.2
    if tone:
        fr = 110 * (8 ** p)
        out += 0.25 * np.sin(2 * np.pi * np.cumsum(fr) / SR) * p ** 3
    return out


def impact(rng, size=1.0):
    """Sub boom 34 + 70 e^(-t/.12) Hz (tau 1.1*size) + low-passed noise + crack."""
    n = int(4.0 * SR)
    t = np.arange(n) / SR
    fr = 34 + 70 * np.exp(-t / 0.12)
    boom = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / (1.1 * size))
    nz = lp(rng.uniform(-1, 1, n), 2400) * np.exp(-t / 0.18)
    crack = hp(rng.uniform(-1, 1, n), 2000) * np.exp(-t / 0.03)
    return np.tanh(1.4 * (boom + 0.5 * nz + 0.25 * crack))


def whoosh(rng, dur=0.7, f0=500, f1=4000, peak=0.55):
    """Band-pass sweep up then back down, loudest at `peak` (fraction of dur)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    p = t / dur
    nz = rng.uniform(-1, 1, n)
    out = np.zeros(n)
    blk = 512
    zi = None
    for a in range(0, n, blk):
        q = a / n
        fc = f0 * (f1 / f0) ** (q if q < peak else (1 - (q - peak) / (1 - peak)))
        sos = signal.butter(2, [fc * 0.6, min(fc * 1.6, SR * 0.45)], "band", fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[a:a + blk], zi = signal.sosfilt(sos, nz[a:a + blk], zi=zi)
    e = np.where(p < peak, (p / peak) ** 2, ((1 - p) / (1 - peak)) ** 1.5)
    return out * e * 2.2


def pop(f=900):
    t = np.arange(int(0.12 * SR)) / SR
    fr = f * (1 + 0.6 * np.exp(-t / 0.01))
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.03) * np.minimum(1, t / 0.001)


def click_sfx(rng):
    t = np.arange(int(0.04 * SR)) / SR
    x = bp(rng.uniform(-1, 1, len(t)), 2000, 9000) * np.exp(-t / 0.003)
    x += 0.5 * np.sin(2 * np.pi * 1400 * t) * np.exp(-t / 0.008)
    return x


def chime(notes=("A5", "E6"), gap=0.07, dur=1.2):
    out = np.zeros(int((dur + gap * len(notes)) * SR))
    for k, nm in enumerate(notes):
        b = bell(hz(nm), dur, ratio=2.0, index=0.8, decay=0.45)
        i = int(k * gap * SR)
        out[i:i + len(b)] += b * 0.5
    return out


# ------------------------------------------------------------------ marker renderer
# Base gains are the prototype's per-event gains; the marker's own `gain` multiplies them.
KNOWN = ("whoosh", "impact", "pop", "click", "type", "chime", "sparkle", "final")


def final_hit_sfx(rng, out, t):
    """Final hit used when there is no music bus (the arranger owns it otherwise)."""
    from .instruments import kick
    add(out, kick(rng, 1.2), t, 0.8)
    add(out, impact(rng, 1.4), t, 0.5)
    for k, nm in enumerate(["D5", "F#5", "A5", "E6"]):
        add(out, bell(hz(nm), 3.5, ratio=2.0, index=0.9, decay=1.4), t + k * 0.09, 0.12, pan=-0.5 + k * 0.33)


def render_sfx(markers, n, rng, *, final_hit=False):
    """Render runtime markers to the SFX bus. Marker `t` is the event start (a whoosh's
    peak lands 55% of its 0.8 s later). Returns (bus, warnings)."""
    out = buf(n)
    warnings = []
    unknown = set()
    for m in sorted(markers, key=lambda m: (float(m.get("t", 0)), str(m.get("kind")))):
        kind = m.get("kind")
        t = float(m.get("t", 0.0))
        g = float(m.get("gain", 1.0) if m.get("gain") is not None else 1.0)
        pan = float(m.get("pan", 0.0) if m.get("pan") is not None else 0.0)
        if kind == "whoosh":
            add(out, whoosh(rng, 0.8, 350, 3800, 0.55), t, 0.35 * g, pan)
        elif kind == "impact":
            add(out, impact(rng, 1.0), t, 0.8 * g, pan)
        elif kind == "pop":
            add(out, lp(whoosh(rng, 0.45, 400, 2500, 0.8), 3000), t - 0.38, 0.15 * g, pan)
            add(out, pop(620), t, 0.35 * g, pan)
        elif kind == "click":
            add(out, click_sfx(rng), t, 0.5 * g, pan)
        elif kind == "type":
            add(out, click_sfx(rng), t, 0.07 * g, pan)
        elif kind == "chime":
            add(out, chime(("E6", "A6"), 0.08, 1.0), t, 0.2 * g, pan)
        elif kind == "sparkle":
            add(out, chime(("A6", "E7"), 0.12, 1.6), t, 0.12 * g, pan)
        elif kind == "final":
            add(out, click_sfx(rng), t, 0.5 * g, pan)
            if final_hit:
                final_hit_sfx(rng, out, t)
        else:
            unknown.add(str(kind))
    for k in sorted(unknown):
        warnings.append(f"unknown marker kind '{k}' ignored")
    return reverb(out, rng, 1.6, 0.18), warnings
