import numpy as np
import pytest

from vsaudio.score import dsp, instruments as ins
from vsaudio.score.arranger import KINDS, PresetError, list_presets, load_preset, plan, validate_preset

PRESETS = ["uplifting-tech", "calm-explainer"]


def test_presets_listed():
    assert set(PRESETS) <= set(list_presets())


@pytest.mark.parametrize("name", PRESETS)
def test_preset_loads_and_validates(name):
    p = load_preset(name)
    assert p["name"] == name
    for k in KINDS:
        assert p["progressions"][k] and k in p["sections"]
    assert set(p["bus_targets"]) == {"pads", "arps", "keys", "bass", "drums", "fx"}


def test_uplifting_matches_reference():
    p = load_preset("uplifting-tech")
    assert p["bpm"] == 96
    assert p["progressions"]["groove"] == ["D", "A", "B", "G"]
    assert p["progressions"]["tension"][:4] == ["Bm", "Bm", "Gi", "Bm"]
    assert p["chords"]["D"]["pad"] == ["D3", "A3", "E4", "F#4"]
    assert p["bus_targets"] == {"pads": -21.0, "arps": -25.0, "keys": -29.0, "bass": -23.0, "drums": -22.5, "fx": -24.0}


def test_invalid_preset_rejected():
    p = load_preset("uplifting-tech")
    p["progressions"]["groove"] = ["D", "Nope"]
    with pytest.raises(PresetError):
        validate_preset(p)
    with pytest.raises(PresetError):
        load_preset("no-such-preset")


def test_plan_sections_and_breath():
    bar = 2.5
    scenes = [
        {"id": "a", "start": 0, "end": 5, "musicCue": "tension"},
        {"id": "b", "start": 5, "end": 15, "musicCue": "groove", "transitionIn": {"type": "flash", "start": 4.55, "end": 5.45}},
        {"id": "c", "start": 15, "end": 20, "musicCue": "groove", "transitionIn": {"type": "iris", "start": 14.5, "end": 15.5}},
    ]
    pl = plan(scenes, 20.0, 96, [{"kind": "final", "t": 18.0}])
    assert abs(pl.bar - bar) < 1e-9
    assert [(s.kind, s.bar0, s.nbars) for s in pl.sections] == [("tension", 0, 2), ("groove", 2, 6)]
    assert pl.breath_bars == {5}  # bar 5 (12.5-15) precedes the iris centred at 15
    assert pl.final_t == 18.0


@pytest.mark.parametrize("note", ["B3", "F#4", "E5", "C#5", "E6", "A6"])
def test_ks_pitch_corrected(note):
    rng = np.random.default_rng(0)
    f = dsp.hz(note)
    x = ins.ks(rng, f, 0.6, damp=0.999, bright=1.0)
    x = x - x.mean()  # the KS excitation carries DC (removed later by the music HP)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)), 8 * len(x)))
    fr = np.fft.rfftfreq(8 * len(x), 1 / dsp.SR)
    spec[fr < 200] = 0
    peak = fr[np.argmax(spec)]
    k = max(1, round(peak / f))  # the strongest partial may be a harmonic
    assert abs(1200 * np.log2(peak / (k * f))) < 2


def test_add_constant_power_pan():
    d = dsp.buf(100)
    dsp.add(d, np.ones(10), 0, 1.0, pan=0.0)
    assert np.allclose(d[0], [1, 1])
    d = dsp.buf(100)
    dsp.add(d, np.ones(10), 0, 1.0, pan=1.0)
    assert np.allclose(d[0], [0, np.sqrt(2)], atol=1e-9)
