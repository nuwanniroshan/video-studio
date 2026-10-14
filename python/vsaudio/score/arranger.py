"""Arranger: resolved scenes + markers + a preset YAML -> six music buses -> automixed music.

Generalises the prototype's hard-coded LuraPlus arrangement (REFERENCE §6.3):

* Grid: beat = 60/bpm, bar = 4 beats, bar 0 at t = 0. Each bar takes the musicCue of the
  scene covering the bar's start; contiguous runs of the same cue form a section. The chord
  progression index restarts per section and advances one chord per bar.
* Section recipes are data (preset `sections`), rendered by generic layer functions.
* Hits: risers ending on the centre of flash/iris transitions, an impact on flash centres,
  a snare roll in the bar before a soft -> strong section change, a breath bar (no kick, clap
  or bass) before iris transitions, and the final hit + ring-out on the `final` marker
  (no new drum hits after it).
* Kick sidechain, per-bus delays/reverbs and per-bus automix exactly as the prototype.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml

from . import instruments as ins
from .dsp import SR, active_mask, add, buf, delay, hp, hz, reverb, rms_db
from .sfx import impact, riser

PRESET_DIR = Path(__file__).parent / "presets"
KINDS = ("tension", "build", "reveal", "groove", "breath", "resolve")
SOFT = {"tension", "build", "breath"}
STRONG = {"reveal", "groove", "resolve"}
BUSES = ("pads", "arps", "keys", "bass", "drums", "fx")
DEFAULT_TARGETS = {"pads": -21.0, "arps": -25.0, "keys": -29.0, "bass": -23.0, "drums": -22.5, "fx": -24.0}
LAYERS = ("pads", "ticks", "sub_pulse", "arp", "shimmer", "kick", "clap", "hats", "bass", "melody")


# ------------------------------------------------------------------ presets
class PresetError(ValueError):
    pass


def list_presets() -> list[str]:
    return sorted(p.stem for p in PRESET_DIR.glob("*.yaml"))


def _check_note(name: str, where: str):
    try:
        hz(name)
    except Exception as e:  # noqa: BLE001
        raise PresetError(f"{where}: bad note name {name!r}") from e


def validate_preset(p: dict) -> dict:
    for k in ("name", "bpm", "chords", "progressions", "sections"):
        if k not in p:
            raise PresetError(f"preset missing '{k}'")
    if not (20 <= float(p["bpm"]) <= 300):
        raise PresetError("bpm out of range")
    for sym, c in p["chords"].items():
        for k in ("pad", "arp", "bass"):
            if k not in c:
                raise PresetError(f"chord {sym} missing '{k}'")
        for nm in list(c["pad"]) + list(c["arp"]) + [c["bass"]]:
            _check_note(nm, f"chord {sym}")
        if len(c["arp"]) < 4:
            raise PresetError(f"chord {sym}: arp needs 4 notes")
    for kind in KINDS:
        prog = p["progressions"].get(kind)
        if not prog:
            raise PresetError(f"progressions.{kind} missing")
        for sym in prog:
            if sym not in p["chords"]:
                raise PresetError(f"progressions.{kind}: unknown chord {sym}")
        sec = p["sections"].get(kind)
        if sec is None:
            raise PresetError(f"sections.{kind} missing")
        for layer, opts in sec.items():
            if layer not in LAYERS:
                raise PresetError(f"sections.{kind}: unknown layer {layer}")
            if opts is not None and not isinstance(opts, dict):
                raise PresetError(f"sections.{kind}.{layer} must be a mapping")
            if opts and "pattern" in opts and any(not 0 <= i < 4 for i in opts["pattern"]):
                raise PresetError(f"sections.{kind}.{layer}.pattern indices must be 0..3")
    mel = p.get("melody")
    if mel:
        for nm in mel.get("notes", []):
            _check_note(nm, "melody")
    fc = p.get("final_chord") or {}
    for nm in list(fc.get("pad", [])) + list(fc.get("bells", [])):
        _check_note(nm, "final_chord")
    targets = {**DEFAULT_TARGETS, **(p.get("bus_targets") or {})}
    for k in targets:
        if k not in BUSES:
            raise PresetError(f"bus_targets: unknown bus {k}")
    p["bus_targets"] = targets
    p.setdefault("hits", {})
    p.setdefault("final_chord", {})
    return p


def load_preset(name_or_path: str) -> dict:
    path = Path(name_or_path)
    if not path.suffix:
        path = PRESET_DIR / f"{name_or_path}.yaml"
    if not path.exists():
        raise PresetError(f"unknown preset {name_or_path!r} (have: {', '.join(list_presets())})")
    return validate_preset(yaml.safe_load(path.read_text()))


# ------------------------------------------------------------------ planning
@dataclass
class Section:
    kind: str
    bar0: int
    nbars: int


@dataclass
class Plan:
    bpm: float
    beat: float
    bar: float
    nbars: int
    bar_kinds: list
    sections: list
    final_t: float
    breath_bars: set = field(default_factory=set)
    warnings: list = field(default_factory=list)


def plan(scenes, duration, bpm, markers) -> Plan:
    beat = 60.0 / bpm
    bar = beat * 4
    nbars = max(1, math.ceil(duration / bar - 1e-9))
    ss = sorted(scenes, key=lambda s: float(s["start"]))
    warnings = []
    kinds = []
    for b in range(nbars):
        t = b * bar
        cover = [s for s in ss if float(s["start"]) <= t + 1e-9 and t < float(s["end"]) - 1e-9]
        if not cover:
            prev = [s for s in ss if float(s["start"]) <= t + 1e-9]
            cover = [prev[-1]] if prev else ss[:1]
        cue = (cover[0].get("musicCue") if cover else None) or "groove"
        if cue not in KINDS:
            warnings.append(f"unknown musicCue '{cue}' treated as groove")
            cue = "groove"
        kinds.append(cue)
    sections = []
    for b, k in enumerate(kinds):
        if sections and sections[-1].kind == k:
            sections[-1].nbars += 1
        else:
            sections.append(Section(k, b, 1))
    finals = [float(m["t"]) for m in markers if m.get("kind") == "final" and m.get("t") is not None]
    final_t = min(finals) if finals else math.inf
    p = Plan(bpm, beat, bar, nbars, kinds, sections, final_t, warnings=warnings)
    for s in ss:
        tr = s.get("transitionIn")
        if tr and tr.get("type") == "iris":
            c = (float(tr["start"]) + float(tr["end"])) / 2
            if c < final_t:
                b = int(math.floor((c - 1e-3) / bar))
                if 0 <= b < nbars:
                    p.breath_bars.add(b)
    return p


# ------------------------------------------------------------------ rendering
class _Score:
    def __init__(self, preset, pl: Plan, n, rng):
        self.p, self.pl, self.n, self.rng = preset, pl, n, rng
        self.b = {k: buf(n) for k in BUSES}
        self.kicks = []

    def ok(self, t):
        """Event gate: nothing new after the final hit, nothing past the end."""
        return t < self.pl.final_t - 1e-6 and t < self.n / SR

    def chord(self, sec: Section, j):
        prog = self.p["progressions"][sec.kind]
        return self.p["chords"][prog[j % len(prog)]]

    # -- layers ---------------------------------------------------------
    def pads(self, o, sec, j, c):
        pl = self.pl
        t = (sec.bar0 + j) * pl.bar
        if not self.ok(t):
            return
        cut = o.get("cutoff", 1800)
        L = sec.nbars
        if isinstance(cut, (list, tuple)):
            a, z = float(cut[0]), float(cut[1])
            if o.get("sweep"):
                c0 = a * (z / a) ** (j / L)
                c1 = a * (z / a) ** ((j + 1) / L)
            else:
                c0 = a + (z - a) * j / max(1, L - 1)
                c1 = None
        else:
            c0, c1 = float(cut), None
        attack = o.get("first_attack", o.get("attack", 0.9)) if j == 0 else o.get("attack", 0.9)
        release = o.get("release", 2.2)
        dur = pl.bar
        if t + dur > pl.final_t:  # bar interrupted by the final hit: short release
            dur = max(0.05, pl.final_t - t)
            release = 0.8
        notes = list(c["pad"]) + ([c["arp"][-1]] if o.get("add_top") else [])
        x = ins.pad(self.rng, notes, dur, cutoff=c0, attack=attack, release=release, bright_to=c1)
        add(self.b["pads"], x, t, o.get("gain", 0.6))

    def ticks(self, o, sec):
        pl = self.pl
        t0, t1 = sec.bar0 * pl.bar, (sec.bar0 + sec.nbars) * pl.bar
        stop = t1 - o.get("stop_beats", 2.4) * pl.beat
        fast_at = t0 + o.get("fast_from", 0.67) * (t1 - t0)
        t, k = t0, 0
        while t < stop and self.ok(t):
            fast = t >= fast_at - 1e-9
            pan = o.get("pan", 0.25)
            add(self.b["fx"], ins.tick(self.rng, k % 2 == 0), t, o.get("gain_fast", 0.16) if fast else o.get("gain", 0.13),
                pan=pan if k % 2 else -pan)
            k += 1
            t += pl.beat / 2 if fast else pl.beat

    def sub_pulse(self, o, sec):
        pl = self.pl
        t0, t1 = sec.bar0 * pl.bar, (sec.bar0 + sec.nbars) * pl.bar
        stop = t1 - o.get("stop_beats", 2.5) * pl.beat
        b = 1
        while True:
            tt = t0 + b * pl.beat
            if tt > stop or not self.ok(tt):
                break
            j = int((tt - t0) // pl.bar)
            add(self.b["bass"], ins.sub_pulse(hz(self.chord(sec, j)["bass"])), tt, o.get("gain", 0.5))
            b += 1

    def arp(self, o, sec):
        pl = self.pl
        rate = int(o.get("rate", 16))
        step = pl.bar / rate
        t0, t1 = sec.bar0 * pl.bar, (sec.bar0 + sec.nbars) * pl.bar
        stop = t1 - o.get("stop_beats", 0) * pl.beat
        fb = o.get("from_bar", 0) if sec.nbars > o.get("from_bar", 0) else 0
        pat = o.get("pattern", [0, 2, 1, 3, 2, 0, 3, 1, 0, 2, 1, 3, 2, 3, 1, 2])
        per_beat = max(1, rate // 4)
        pan = o.get("pan", 0.35)
        for j in range(fb, sec.nbars):
            c = self.chord(sec, j)
            for s in range(rate):
                tt = t0 + j * pl.bar + s * step
                if tt >= stop - 1e-9 or not self.ok(tt):
                    continue
                i = j * rate + s
                nm = c["arp"][pat[i % len(pat)]]
                acc = 1.0 if s % per_beat == 0 else o.get("accent", 0.7)
                x = ins.ks(self.rng, hz(nm), o.get("dur", 0.45), damp=o.get("damp", 0.993), bright=o.get("bright", 0.55))
                add(self.b["arps"], x, tt, o.get("gain", 0.36) * acc, pan=-pan if s % 2 else pan)

    def shimmer(self, o, sec):
        pl = self.pl
        rate = int(o.get("rate", 16))
        step = pl.bar / rate
        t0, t1 = sec.bar0 * pl.bar, (sec.bar0 + sec.nbars) * pl.bar
        pat = o.get("pattern", [0, 1, 2, 3, 3, 2, 1, 2])
        mult = 2 ** o.get("octave", 1)
        for i in range(sec.nbars * rate):
            tt = t0 + i * step
            if not self.ok(tt):
                break
            c = self.chord(sec, i // rate)
            f = hz(c["arp"][pat[i % len(pat)]]) * mult
            g = o.get("gain", 0.12) * (0.6 + 0.4 * (tt - t0) / (t1 - t0))
            x = ins.bell(f, o.get("dur", 1.0), ratio=o.get("ratio", 3.0), index=o.get("index", 0.6), decay=o.get("decay", 0.35))
            add(self.b["keys"], x, tt, g, pan=float(np.sin(i * 0.7) * 0.6))

    def kick(self, o, sec, j):
        pl = self.pl
        if j < o.get("from_bar", 0) or (sec.bar0 + j) in pl.breath_bars:
            return
        for bt in o.get("beats", [0, 1, 2, 3]):
            tt = (sec.bar0 + j) * pl.bar + bt * pl.beat
            if self.ok(tt):
                add(self.b["drums"], ins.kick(self.rng), tt, o.get("gain", 0.9))
                self.kicks.append(tt)

    def clap(self, o, sec, j):
        pl = self.pl
        if j < o.get("from_bar", 0) or (sec.bar0 + j) in pl.breath_bars:
            return
        for bt in o.get("beats", [1, 3]):
            tt = (sec.bar0 + j) * pl.bar + bt * pl.beat
            if self.ok(tt):
                add(self.b["drums"], ins.clap(self.rng), tt, o.get("gain", 0.42), pan=0.05)

    def hats(self, o, sec, j):
        pl = self.pl
        rate = int(o.get("rate", 16))
        per_beat = max(1, rate // 4)
        vel = o.get("velocities", [0.35, 0.18, 0.55, 0.2])
        opn = o.get("open")
        t0, t1 = sec.bar0 * pl.bar, (sec.bar0 + sec.nbars) * pl.bar
        start = t0 + o.get("from_frac", 0.0) * (t1 - t0)
        for b in range(4):
            for s in range(per_beat):
                tt = (sec.bar0 + j) * pl.bar + b * pl.beat + s * pl.beat / per_beat
                if tt < start - 1e-9 or not self.ok(tt):
                    continue
                is_open = bool(opn) and b == opn[0] and s == opn[1]
                add(self.b["drums"], ins.hat(self.rng, open_=is_open), tt, vel[s % len(vel)] * o.get("gain", 0.55),
                    pan=o.get("pan", 0.35))

    def bass(self, o, sec, j, c):
        pl = self.pl
        if j < o.get("from_bar", 0) or (sec.bar0 + j) in pl.breath_bars:
            return
        rate = int(o.get("rate", 8))
        slot = pl.bar / rate
        oe = int(o.get("octave_every", 4) or 0)
        f = hz(c["bass"])
        for e in range(rate):
            tt = (sec.bar0 + j) * pl.bar + e * slot
            if not self.ok(tt):
                continue
            fe = f * (2 if oe and e % oe == oe - 1 else 1)
            add(self.b["bass"], ins.bass_note(fe, slot * o.get("length", 0.85)), tt, o.get("gain", 0.42))

    def melody(self, o, sec):
        mel = self.p.get("melody")
        L = sec.nbars
        if not mel or L < o.get("min_bars", 8):
            return
        a = int(round(L * 0.36))
        z = max(a + 1, L - int(round(L * 0.18)))
        beats = mel.get("beats", [0, 1.5, 3])
        notes = mel["notes"]
        pl = self.pl
        for j in range(a, z):
            for k, bt in enumerate(beats):
                tt = (sec.bar0 + j) * pl.bar + bt * pl.beat
                if not self.ok(tt):
                    continue
                nm = notes[((j - a) * len(beats) + k) % len(notes)]
                x = ins.bell(hz(nm), mel.get("dur", 1.4), ratio=mel.get("ratio", 3.0), index=mel.get("index", 1.0),
                             decay=mel.get("decay", 0.55))
                add(self.b["keys"], x, tt, o.get("gain", 0.075), pan=mel.get("pan", 0.2))

    # -- sections & hits ------------------------------------------------
    def section(self, sec: Section):
        rec = self.p["sections"][sec.kind] or {}
        for j in range(sec.nbars):
            c = self.chord(sec, j)
            if rec.get("pads"):
                self.pads(rec["pads"], sec, j, c)
            if rec.get("kick"):
                self.kick(rec["kick"], sec, j)
            if rec.get("clap"):
                self.clap(rec["clap"], sec, j)
            if rec.get("hats"):
                self.hats(rec["hats"], sec, j)
            if rec.get("bass"):
                self.bass(rec["bass"], sec, j, c)
        for layer in ("ticks", "sub_pulse", "arp", "shimmer", "melody"):
            if rec.get(layer):
                getattr(self, layer)(rec[layer], sec)

    def hits(self, scenes):
        pl, h = self.pl, self.p["hits"]
        ss = sorted(scenes, key=lambda s: float(s["start"]))
        for i, s in enumerate(ss):
            tr = s.get("transitionIn")
            if not tr or tr.get("type") not in ("flash", "iris"):
                continue
            c = (float(tr["start"]) + float(tr["end"])) / 2
            if c >= pl.final_t:
                continue
            prev_len = float(ss[i - 1]["end"]) - float(ss[i - 1]["start"]) if i > 0 else c
            L = max(0.05, min(2.2, prev_len, c))
            if tr["type"] == "flash":
                add(self.b["fx"], riser(self.rng, L, 250, 7000), c - L, h.get("riser_gain", 0.55))
                Lr = min(1.2, L)
                add(self.b["fx"], riser(self.rng, Lr, 2000, 12000, tone=False), c - Lr, h.get("riser_tail_gain", 0.35))
                add(self.b["fx"], impact(self.rng, h.get("impact_size", 1.3)), c, h.get("impact_gain", 0.95))
            else:
                add(self.b["fx"], riser(self.rng, L, 400, 6000), c - L, h.get("iris_riser_gain", 0.32))
        if h.get("snare_roll", True):
            for a, b in zip(pl.sections, pl.sections[1:]):
                if a.kind in SOFT and b.kind in STRONG and b.bar0 >= 1:
                    start, end = (b.bar0 - 1) * pl.bar, b.bar0 * pl.bar
                    t = start
                    while t < end - 1e-9 and self.ok(t):
                        p = (t - start) / pl.bar
                        add(self.b["drums"], ins.clap(self.rng) * (0.15 + 0.5 * p ** 2), t, h.get("roll_gain", 0.6))
                        t += pl.beat / (2 if p < 0.5 else 4)

    def final(self):
        pl, fc = self.pl, self.p["final_chord"]
        t = pl.final_t
        if not (t < self.n / SR):
            return
        add(self.b["drums"], ins.kick(self.rng, 1.2), t, fc.get("kick_gain", 1.0))
        add(self.b["fx"], impact(self.rng, 1.4), t, fc.get("impact_gain", 0.6))
        bells = fc.get("bells") or []
        for k, nm in enumerate(bells):
            add(self.b["keys"], ins.bell(hz(nm), 3.5, ratio=2.0, index=0.9, decay=1.4), t + k * 0.09,
                fc.get("bell_gain", 0.12), pan=-0.5 + k * (1.0 / max(1, len(bells) - 1)))
        if fc.get("pad"):
            x = ins.pad(self.rng, fc["pad"], 3.2, cutoff=3000, attack=0.02, release=3.5)
            add(self.b["pads"], x, t, fc.get("pad_gain", 0.95))

    def sidechain(self):
        sc = np.ones(self.n)
        n = int(0.32 * SR)
        g = 1 - 0.55 * np.exp(-np.arange(n) / SR / 0.09)
        for kt in self.kicks:
            i = int(kt * SR)
            j = min(self.n, i + n)
            if j > i:
                sc[i:j] = np.minimum(sc[i:j], g[: j - i])
        self.b["pads"] *= sc[:, None]
        self.b["bass"] *= sc[:, None] ** 1.3
        self.b["arps"] *= (0.5 + 0.5 * sc)[:, None]


def section_mask(pl: Plan, n: int, kinds=("groove",)) -> np.ndarray:
    m = np.zeros(n, dtype=bool)
    for s in pl.sections:
        if s.kind in kinds:
            a = int(round(s.bar0 * pl.bar * SR))
            b = int(round((s.bar0 + s.nbars) * pl.bar * SR))
            m[a:min(n, b)] = True
    return m


def arrange(preset: dict, scenes, markers, duration: float, seed: int, bpm: float | None = None):
    """Render the score. Returns (music (n,2) float64, info dict)."""
    n = int(round(duration * SR))
    bpm = float(bpm or preset["bpm"])
    pl = plan(scenes, duration, bpm, markers)
    rng = np.random.default_rng([int(seed), 1])
    sc = _Score(preset, pl, n, rng)
    for sec in pl.sections:
        sc.section(sec)
    sc.hits(scenes)
    sc.final()
    sc.sidechain()

    b = sc.b
    b["arps"] = delay(b["arps"], pl.beat * 0.75, fb=0.32, taps=4)
    b["keys"] = delay(b["keys"], pl.beat * 0.75, fb=0.3, taps=4)
    fxrng = rng
    buses = {
        "pads": reverb(b["pads"], fxrng, 3.2, 0.45),
        "arps": reverb(b["arps"], fxrng, 2.2, 0.3),
        "keys": reverb(b["keys"], fxrng, 3.0, 0.5),
        "bass": b["bass"],
        "drums": reverb(b["drums"], fxrng, 1.2, 0.12),
        "fx": reverb(b["fx"], fxrng, 2.8, 0.35),
    }

    groove = section_mask(pl, n, ("groove",))
    targets = preset["bus_targets"]
    music = np.zeros((n, 2))
    gains = {}
    for name in BUSES:
        x = buses[name]
        act = active_mask(x, 1e-4)
        if not act.any():
            gains[name] = None  # silent bus: skipped
            continue
        if name == "fx":
            seg = x[active_mask(x, 1e-3)] if active_mask(x, 1e-3).any() else x[act]
        else:
            seg = x[groove] if groove.any() else np.empty((0, 2))
            if seg.size == 0 or rms_db(seg) < -70:
                seg = x[act]
        g_db = targets[name] - rms_db(seg)
        gains[name] = round(g_db, 2)
        music += x * 10 ** (g_db / 20)
    music = hp(music, 28)
    region = groove if groove.any() and rms_db(music[groove]) > -70 else active_mask(music, 1e-4)
    info = {
        "bpm": bpm,
        "bar": pl.bar,
        "sections": [{"kind": s.kind, "bar0": s.bar0, "bars": s.nbars} for s in pl.sections],
        "breathBars": sorted(pl.breath_bars),
        "busGainsDb": gains,
        "region": region,
        "warnings": pl.warnings,
    }
    return music, info
