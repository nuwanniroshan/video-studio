# Reference: what the LuraPlus prototype taught us

This document records everything learned building the LuraPlus film: exact parameters, measured numbers, the pitfalls we hit, and working commands. Port from it instead of rediscovering it.

The prototype lives here (**read-only; copy files, never edit in place**):

```
/Users/swiveltech/Disk/Swivel/acentra-platform/marketing/promo-video
```

---

## 1. Prototype map

| Path | Lines | What it does |
|---|---|---|
| `timeline.json` / `timeline.js` | — | Single source of timing: `{fps:60,width:1920,height:1080,bpm:96,duration:92.5,scenes[{id,start,end,title}],vo[{id,t}]}`. `timeline.js` is `window.TL = <json>` because `fetch()` doesn't work on `file://`. |
| `src/engine.js` | 260 | Seekable motion engine (§2) |
| `src/index.html` | 755 | All scene markup (absolute px), an SVG icon sprite (`<symbol>` set), and the cursor symbol |
| `src/styles.css` | 192 | Tokens, primitives, layout |
| `src/scenes.js` | 632 | Choreography with absolute times, plus motion helpers |
| `render.mjs` | 118 | `stills` and `video` modes (§4) |
| `audio/vo_script.json` | — | Voice, speed and lines `{id, text, phonemes?}` |
| `audio/gen_vo.py` | 54 | Kokoro TTS → `audio/vo/L*.wav` + `durations.json` |
| `audio/score.py` | 600 | Music, SFX, VO processing, mix and stems (§6) |
| `finish.py` | 59 | Deliverables, SRT and posters (§7) |
| `fonts/` | — | Onest, Open Sans, JetBrains Mono (variable TTF, OFL, from google/fonts) |
| `assets/` | — | `lura-logo.png` (1230×263), `lura-favicon.png` |
| `README.md` | — | Creative brief, story, script/shot list, craft decisions, re-render steps |
| `build/video.mp4` | — | Silent master picture, CRF 8, 60 fps, 5550 frames |
| `output/` | — | All deliverables |

**Workflow used:**
1. `gen_vo.py`, which gives the line durations.
2. Hand-design `timeline.json` around them.
3. Write the scenes.
4. Iterate with `node render.mjs stills <t…>` plus contact sheets.
5. `score.py`.
6. `node render.mjs video --sub 3 --workers 7` (933 s).
7. `finish.py`.

---

## 2. Motion engine semantics (`src/engine.js`)

**Model.**
- A track is `(element, prop)` holding a list of segments `{t0, d, a, b, e}`.
- `seek(t)`:
  1. sets `display`/`visibility` from `window()` ranges;
  2. evaluates every channel;
  3. composes transform and filter;
  4. runs the `fn` callbacks.

**Props:**

| Group | Props |
|---|---|
| Transform | `x y z` (px), `s sx sy`, `r rx ry` (deg). Composed as `translate3d(x,y,z) rotateX(rx) rotateY(ry) rotate(r) scale(s·sx, s·sy)` |
| Opacity | `o` (clamped 0..1) |
| Filter | `blur` (px), `bright`, `sat` |
| Size | `w h` (px), `pct` (width %) |
| SVG draw | `dash` (strokeDashoffset = 1 − v; the path needs `pathLength="1"` and `stroke-dasharray: 1 1`) |
| Clip | `clipX` / `clipY` (`inset()` reveal %), `clipR` (`circle(r% at var(--cx) var(--cy))`, for iris wipes) |

**API.**
- `tw(target, t0, d, from|null, to, ease)`. `from: null` means *continue from the previous segment's end value* (`b`), **not** the live value at `t0`.
- `from(target, t0, d, fromVals)` animates to the defaults. `to()` continues. `set()` takes 0.0001 s.
- `stagger(targets, t0, gap, d, fromVals)`.
- `fn(t0, d, cb(p, t), ease, key?)`.
- `window(target, a, b)`.
- Text: `revealWords`, `hideWords`, `type`, `count`.
- `rand(seed)` is xorshift.

**Easing.**

| Name | Curve |
|---|---|
| `out` | bezier(0.16, 1, 0.3, 1), the house default |
| `in` | (0.7, 0, 0.84, 0) |
| `inOut` | (0.83, 0, 0.17, 1), for camera moves |
| `smooth` | (0.45, 0, 0.2, 1), for cursor moves and lines |
| `soft` | (0.25, 0.1, 0.25, 1) |
| `back` | overshoot c1 = 1.4 |
| `spring` | `1 − e^(−6.5p)·cos(2.6πp)`, for drops |

**Pitfalls, each hit for real. Encode the fixes in the TS port:**

1. **The "continue" value is the previous target, not the live value.** If segment B starts before segment A ends, B jumps.
   - Avoid overlapping segments on the same prop.
   - In the port, either clamp or compute live values.
   - Example: the frame's "sway" segments had to end exactly where the pull-back began.
2. **Before the first segment, the value is the first segment's `a`.** `null` resolves to the default (`o: 1`), so an element meant to appear later flashes visible at t = 0.
   - Fix: `hide(el) = set(el, -1, {o: 0})` before any `tw` with an explicit `from`.
   - The port should support `initial` state explicitly.
3. **`fn` callbacks run on every seek with p clamped**, so they also run before `t0` with p = 0.
   - Two `fn`s driving the same DOM property: the later-registered one always wins, even before its start time. The second sheen sweep blanked the first.
   - Fix: give such callbacks a shared `key`. Only the latest-started member of a key group runs (first one if none has started).
4. **`E.from` animates to `DEFAULTS`.** `pct`, `h`, `dash` and `clip*` have no default (they resolve to 0), so use explicit `tw` for those.
5. **A dashed SVG path can't use `dash` to draw**, because the dasharray conflicts. Wrap it in its own `<svg>` and animate `clipX` on the wrapper (the calibration target curve).
6. **Measure layout before the first `seek()`.** `window()` sets `display: none`, which zeroes rects. All `rel(el, ref)` measurements ran at setup while every element was still displayed and untransformed.
7. **Word splitting** uses the regex `/(\s+|<[^>]+>)/`, which keeps inline tags such as `<span class="blue">` and `<br/>` intact. Each word becomes `<span class="w"><span class="wi">word</span></span>`.
8. **`fn` with `ease.linear` and a tiny `d`** is the deterministic "at time T, toggle a class or style" primitive (`at()` helper). Pair it with an `off` callback for times before T.
9. **Performance:** `seek()` loops over every channel. The port should index segments with binary search and evaluate only active scenes.

---

## 3. House style (visual constants that made it look premium)

**Stage and canvas.**
- 1920×1080.
- Dark acts: `--navy #070B14` with radial blue and violet glows, plus a 64 px hairline grid at `rgba(255,255,255,.035)`.
- Light acts: `#F7F8FA` with a 64 px grid at `rgba(14,17,22,.035)` (radial mask), two blurred orbs (blue `.16`, violet `.08`, `filter: blur(80px)`) drifting by sin/cos over t, and a light vignette.

**Brand tokens** (from the Aurora theme `luraPlusLightTheme.ts`):

| Group | Values |
|---|---|
| Blue | #3782F7, 400 #5697F8, 600 #1F6BE8, 700 #1856C4, 50 #EAF2FE, 100 #D3E4FD, 200 #A9C9FB |
| Greys | 950 #0E1116 through 25 #FCFCFD |
| Status | green #1FA463 / #178551 / #E8F6EF; amber #E0900F / #B9730A / #FBF1E1; red #E5484D; violet #7C5CFC / #F0ECFF |
| Shadows | md `0 6px 16px rgba(14,17,22,.08)`; xl `0 30px 80px rgba(14,17,22,.18), 0 8px 24px rgba(14,17,22,.08)` |

**Typography.**

| Role | Font and size |
|---|---|
| Display | Onest 600, h1 80 px, line-height 1.02, letter-spacing −0.035em |
| UI | Open Sans; 15 px body, 12–13 px tiny labels |
| Kicker | JetBrains Mono 17 px, uppercase, letter-spacing .16em, blue, with `num` (grey) + 36 px bar + label |

Copy column: `left 112px, width 520px`, vertically centred, gap 26 px.

**Two-tone headlines.** Statement in ink, payoff in blue (light acts) or muted white `.38` (dark acts).

**App frame.**
- `left 676, top 104, 1150×872`, radius 16, big soft shadow, inside `perspective: 2400px; perspective-origin: 70% 50%`.
- Rest pose `rx 2°, ry −5°`. A gentle sway alternates `ry −6.5° / −3.2°` and `rx 1.2° / 2.6°` per scene (ease `soft`).
- Sidebar 214 px with a nav pill that glides (0.55 s, ease `out`); topbar 64 px; content 936×808.

**Standard motions:**

| Motion | Parameters |
|---|---|
| Frame entry | `from {y:340, x:60, rx:26, ry:−22, s:.9, o:0}`, 1.4 s, `out` |
| Pane in | `from {y:46, o:0, blur:6}`, 0.85 s. Pane out: `to {y:−36, o:0, blur:6}`, 0.42 s, `in` |
| Copy in | kicker `{y:16, o:0}` 0.7 s; h1 words gap 0.055, 0.9 s, dist 44, blur 8 at +0.12 s; sub `{y:18, o:0, blur:5}` 0.9 s at +0.55 s. Copy out `{y:−30, o:0, blur:6}` 0.42 s |
| Card stagger | gap 0.06–0.08 s, `{y:30–34, o:0}`, 0.8–0.9 s |
| Pop | `{s:.4, o:0}`, 0.5 s, ease `back` |
| Press | s → .95 in 0.08 s, then back in 0.35 s |
| Cursor | show fades 0.3 s; moves 0.5–0.9 s ease `smooth`; click scale → .82 in 0.08 s, back in 0.25 s; ripple ring 56 px, `s .3 → 1.6`, `o .9 → 0` over 0.6 s; arrive ~0.15–0.2 s before the click |
| Pop-out card | `from {y:90, s:.9, o:0, rx:14, blur:8}`, 1.0 s, then a slow drift `{ry:−2.5, y:−6}`; exit `{y:−40, o:0, s:.97, blur:6}` 0.45 s `in`. Content behind dims: `blur 3, bright .93`. |
| Drag | lift `s 1.06, r −3°` plus a big shadow; x move 0.9 s `inOut` with a y arc of −26 px; drop with `spring` |
| Iris wipe | `clipR 0 → 120`, ~1 s, `inOut` (light world opens at 19.25 s; dark returns at 74.65 s) |
| Collapse | every window flies to the stage centre `s → .04, r ±28°`, 1.05 s ease `in`, plus a glow bloom, then a white flash peaking at the cut (0.14 s in, 0.9 s out) |
| Logo reveal | `{s:1.16, o:0, blur:26} → rest`, 1.6 s; sheen = masked `linear-gradient(100deg…)` with `background-size 300%`, position 100% → 0% over 1.3 s; flare line `sx .1 → 1.2 → 1.6`. Needs a CSS `mask:url(logo.png)`, which **fails over `file://` (CORS)**: use http or `--allow-file-access-from-files`. |
| Grain | 8 pre-generated 960×540 noise frames, switched at 24 fps, `mix-blend-mode: overlay`, opacity .22 dark / .14 light. In the new product, move it to the ffmpeg post-pass. |

**Editing craft:**
- Cuts land on the beat grid: 96 BPM, beat 0.625 s, bar 2.5 s.
- VO starts 0.25–0.45 s after a scene cut.
- Each visual beat lands 0.2–0.6 s after the VO says it.
- Order VO clauses to match the visual order. We had to rewrite L14 to "weighted goals, blind reviews, calibration" because that's the order the visuals show them.
- **Text must carry the story muted**, because landing pages and social feeds autoplay muted.
- Problem act on dark, product act on light, brand moments on dark.
- One persistent app frame for the whole tour, so the viewer experiences "no app switching".
- End on a held CTA card (≥ 5 s) for posters and loops.

**QA loop:**
- Render stills at key times, then tile them into contact sheets:
  ```
  ffmpeg -i a.png … -filter_complex "xstack=inputs=6:layout=0_0|w0_0|0_h0|w0_h0|0_h0+h1|w0_h0+h1,scale=1920:-1" sheet.jpg
  ```
- For the final video:
  ```
  ffmpeg -i master.mp4 -vf "fps=1/3.7,scale=384:-1,tile=5x5:padding=4" -frames:v 1 sheet.jpg
  ```
- Bugs this caught: overlapping popups (radar over the scores), headline wraps ("Log in / minutes"), clipped funnel labels, a misplaced pill, empty card space.

---

## 4. Renderer (`render.mjs`)

### 4.1 Capture

- `chromium.launch()` gets **one browser per worker**. With a shared browser and multiple pages, captures serialize on the GPU/compositor process: 1.0 fps vs 6.6 fps.
- `page.context().newCDPSession(page)` then `Page.captureScreenshot({format:'png', optimizeForSpeed:true, captureBeyondViewport:false})`, which is much faster than `page.screenshot()`.
- Viewport 1920×1080 with `deviceScaleFactor 1`.
- Wait for `window.__ready`, which resolves `document.fonts.ready` and decodes all images, then `seek(0)`.
- Errors surface through `page.on('pageerror')` and `console` errors.

### 4.2 Motion blur

```
t(i, k) = t0 + i/fps + (k/sub)·(shutter/fps) − (shutter/fps)/2      // shutter = 0.5 (180°), sub = 3
ffmpeg -f image2pipe -framerate fps*sub -c:v png -i - \
  -vf "tmix=frames=sub,select='eq(mod(n\,sub)\,sub-1)',setpts=N/(fps*TB)" -r fps \
  -c:v libx264 -preset medium -crf 8 -pix_fmt yuv420p seg-XX.mp4
```

- Static content produces identical sub-frames, so it stays sharp.
- Write PNG buffers to ffmpeg stdin, respecting backpressure (`drain`).

### 4.3 Measured performance (M1 Pro, 8 cores, 1080p)

| Config | Output fps | 92.5 s @60 fps |
|---|---|---|
| 6 pages in 1 browser, `page.screenshot`, sub 3 | 1.0 | ~90 min |
| 7 browsers, CDP `optimizeForSpeed`, sub 3 | **6.6** | **933 s (15.5 min)** |
| `finish.py` (master, web, hero mp4, VP9 webm, stills, stems) | — | 4 min 48 s |

### 4.4 Partial re-render (used to change the end-card URL)

Render only the changed range, then splice it in frame-exactly:

```
node render.mjs video --from 80 --to 92.5 --sub 3 --workers 7 --out build/tail.mp4
ffmpeg -i video.mp4 -i tail.mp4 -filter_complex \
  "[0:v]trim=end_frame=4800,setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1[v]" \
  -map "[v]" -r 60 -c:v libx264 -preset medium -crf 8 -pix_fmt yuv420p video_new.mp4
```

Here `4800 = 80 s × 60 fps`. Verify with `ffprobe -count_frames` (5550).

This splice is the seed of the segment cache in the new product.

### 4.5 Gotchas

- `file://` blocks CSS `mask:url()` and `fetch` (CORS). The prototype used `--allow-file-access-from-files`. **The new product must serve over `http://127.0.0.1` and block all other origins with `page.route`**, because AI or user content could otherwise read local files.
- The Claude desktop browser preview reports `document.visibilityState = "hidden"`, so videos pause and screenshots show a black `<video>` layer. Verify playback by drawing the video onto a canvas and sampling luma; it was 231 at 40 s, which confirmed real frames.

---

## 5. Voice (TTS)

### 5.1 Setup that works on macOS (Python 3.13)

```bash
python3 -m venv venv && ./venv/bin/pip install kokoro-onnx soundfile numpy scipy faster-whisper
./venv/bin/pip uninstall -y phonemizer && ./venv/bin/pip install --force-reinstall --no-deps phonemizer-fork
brew install espeak-ng
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx   # 325 MB
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin    # 28 MB
ESPEAK_LIB=/opt/homebrew/lib/libespeak-ng.dylib ESPEAK_DATA=/opt/homebrew/share/espeak-ng-data python gen_vo.py <model_dir>
```

### 5.2 Failures we hit

| Symptom | Cause | Fix |
|---|---|---|
| `Error processing file '/Users/runner/work/espeakng-loader/…/phontab'` on import or load | The bundled `espeakng-loader` dylib has a CI build path baked in. `ESPEAK_DATA_PATH` doesn't help. | Use system espeak-ng via `EspeakConfig(lib_path=…, data_path=…)`. In Docker: `apt-get install espeak-ng`. |
| (same error, after swapping libraries) | phonemizer 3.4 regression | `phonemizer-fork` |
| faster-whisper `TypeError: open() got an unexpected keyword argument 'metadata_errors'` | Version mismatch between PyAV and faster-whisper | Pass a float32 numpy array resampled to 16 kHz (`resample_poly(x, 2, 3)` from 24 kHz) instead of a file path |

### 5.3 Settings

- Voice `af_heart` (Kokoro's grade-A US female voice), speed 0.94, `lang="en-us"`.
- Trim silence at −45 dB re peak, with a 40 ms pad in front and 80 ms behind.
- Output 24 kHz mono. Resample to 48 kHz with `resample_poly(x, 2, 1)` for the mix.
- Per-line processing in the mix:
  - high-pass 85 Hz;
  - +25% band 2.5–5 kHz (presence) and +12% above 8 kHz (air);
  - soft-knee compression on the Hilbert envelope (threshold 0.25·max, ratio about 2.5:1);
  - normalize peaks to 0.7;
  - small room reverb (RT 0.7 s, mix 0.08).

### 5.4 Pronunciation

- "A.I." produced an audible pause ("with A, I. That…"). Plain "AI" reads correctly as /ˌeɪˈaɪ/.
- **"Lura"**: espeak defaults to `lˈʊɹɹə` ("lure-a"). The respellings "Loora" and "Lurah" gave `lˈɔːɹə` ("Laura"). We used an explicit phoneme override (`kokoro.create(phonemes, is_phonemes=True)`):
  ```
  mˈiːt lˈuːɹə plˈʌs.
  lˈuːɹə plˈʌs. ɹˈʌn jʊɹ ɛntˈaɪɚ bˈɪznəs, fɹʌm wˈʌn plˈætfɔːɹm.
  ```
  The new product needs a **brand dictionary** so nobody hand-writes whole-line IPA.
- `k.tokenizer.phonemize(text, "en-us")` shows what espeak will say. Expose this in the brand-kit UI.

### 5.5 Whisper QA

- `small.en`, int8, CPU, beam 5. It correctly transcribed 17 of 19 lines.
- It is **unreliable for invented brand names**: "Lura" came back as Lyra, Laura or Lira depending on context and prompt. Score only non-dictionary words; for brand terms, rely on "Play line" by a human.

### 5.6 Measured line durations (speed 0.94)

About 2.2–2.6 words per second, for example:
- 6.44 s for a 17-word line;
- 1.16 s for "Meet LuraPlus.";
- 8.09 s for a 19-word line.

The script totalled 67.4 s of speech in a 92.5 s film, about 73% density, which felt unhurried.

---

## 6. Music, SFX and mix (`audio/score.py`)

### 6.1 Framework

- 48 kHz stereo float64 buffers.
- `add(dst, x, t, gain, pan)` uses a constant-power pan, `cos((p+1)π/4)` and `sin(…)` with `√2` compensation.
- Filters are scipy Butterworth SOS.
- `sweep_lp` is a block-wise (256-sample) time-varying low-pass that carries `zi` state between blocks. It's a hack that works for slow sweeps.

### 6.2 Instruments

| Instrument | Recipe |
|---|---|
| `pad(notes)` | 3 detuned saws per note (−9, 0, +9 cents, panned −.8 / 0 / .8) plus a sub-octave sine at .12; low-pass at the cutoff (or swept); ADSR with a 0.9 s attack and 2.2 s release |
| `ks(f)` | Karplus-Strong. Integer period `P = round(SR/f)`. The block-vectorized loop runs one period per numpy op. **Pitch-correct** by resampling with `np.interp`. *Correction found in M1:* the two-point averaging filter adds half a sample of delay, so the string sounds at `SR/(P+0.5)`, not `SR/P`; the prototype's ratio `f/(SR/P)` left notes flat (E6 −23.8 cents). `vsaudio` resamples by `f/(SR/(P+0.5))`, which measures within 0.05 cents from B3 to A6. |
| `bell(f)` | 2-op FM, ratio 2–3.5, index decaying with τ = 0.35·decay |
| `kick()` | Sine with a pitch envelope `46 + 110·e^(−t/.035)` Hz, amplitude τ 0.22 s, a 3 kHz noise click, `tanh(1.6x)` |
| `clap()` | Noise band-passed 0.9–3.2 kHz, three bursts at 0, 11 and 22 ms with a 0.12 s tail |
| `hat()` | Noise high-passed at 7.5 kHz (4th order), τ 45 ms (open: 180 ms) |
| `bass_note()` | 0.6 saw + 0.8 sine, low-passed at 420 Hz, `tanh(1.3x)` |
| `tick()` | Clock tick: 2.6 / 1.9 kHz alternating "tick-tock", τ 6 ms |

**SFX:**
- `riser`: band-passed noise sweeping up, block-wise, `·p^2.2`, plus a rising sine `110·8^p`.
- `impact`: sub boom `34 + 70·e^(−t/.12)` Hz with τ 1.1·size, plus low-passed noise and a crack.
- `whoosh`: a band-pass sweep up then down, peak at 55%.
- `pop`, `click_sfx` and `chime` (FM bells).

**Effects:**
- `reverb_ir(rt)` is stereo Gaussian noise × `e^(−6.9t/rt)`, low-passed at 5.2 kHz, with a 20 ms predelay, normalized; applied with `fftconvolve`.
- `delay` is ping-pong with feedback ~0.3 at a dotted-eighth (0.75 beat).

### 6.3 The LuraPlus arrangement (the `uplifting-tech` preset)

**Harmony.** D major at 96 BPM.

| Chord | Pad | Arp | Bass |
|---|---|---|---|
| D | D3 A3 E4 F#4 | D4 F#4 A4 E5 | D2 |
| A | A2 E3 C#4 B4 | — | A1 |
| B (Bm7) | B2 F#3 D4 A4 | — | B1 |
| G | G2 D3 B3 F#4 | — | G1 |
| Bm (intro, add9) | B2 F#3 D4 C#4 | — | — |
| Gi (intro) | G2 D3 B3 F#4 | — | — |

The main loop runs D–A–Bm–G (I–V–vi–IV) at one chord per bar.

**Structure by bars** (2.5 s each):

| Bars | Time | Section | Contents |
|---|---|---|---|
| 0–5 | 0–15 s | Tension | Bm/G pads with the low-pass opening 500 → 1100 Hz; clock ticks on beats, switching to eighths after 10 s; sub pulse on beats; muted Karplus-Strong plucks in eighths; riser and reverse swell into the drop |
| — | 15.0 s | Hit | **Impact** |
| 6–7 | 15–20 s | Reveal | Big D and G pads; FM-bell 16th shimmer |
| 8–29 | 20–75 s | Groove | Four-on-the-floor kick; claps on 2 and 4 from bar 10; 16th hats; eighth bass from bar 9 (octave on every fourth eighth); KS arp in 16ths with pattern `[0,2,1,3,2,0,3,1,0,2,1,3,2,3,1,2]`; bell counter-melody in bars 16–25 |
| 26 | — | Breath | No kick, clap or bass, plus a riser into the pull-back |
| 30–31 | 75–80 s | Suspended | No drums; pad low-pass sweeping up; 3.2 s riser; accelerating snare roll |
| 32–34 | 80–87.5 s | Final chorus | — |
| — | 87.5 s | Final hit | Kick, impact and bell chord, timed to the CTA click, then a ring-out |

**Sidechain.** Gain `1 − 0.55·e^(−t/0.09)` per kick. Pads take the gain directly, bass `^1.3`, arps half-depth.

### 6.4 Mix (final, verified)

**Per-bus automix.** Each bus is measured over the 20–75 s groove (fx only where active), then gained to a target RMS:

| Bus | Target (dB) | Raw measured (dB) | Applied gain (dB) |
|---|---|---|---|
| pads | −21 | −31.4 | +10.4 |
| arps | −25 | −28.1 | +3.1 |
| keys | −29 | −35.4 | +6.4 |
| bass | −23 | −21.2 | −1.8 |
| drums | −22.5 | −10.6 | −11.9 |
| fx | −24 | −19.2 | −4.8 |

The first mix had no automix: drum transients dominated, music RMS sat 15 dB under the VO, and the pads were inaudible.

**Mix chain:**
- Music → `VO_rms(active) − 5 dB`, then the duck curve: −6.5 dB, VO gate 0.02, attack 40 ms, release 450 ms, 10 ms hop.
- SFX → `VO_rms − 9 dB`, multiplied by `0.5 + 0.5·duck`.
- Sum, then `tanh(1.1x)/1.1`, a 1.2 s squared fade on the tail, and a peak of 0.89.

**Result:**
- Integrated **−17.3 LUFS**, true peak −1.0 dBFS, LRA 4.8 LU.
- Per bar: VO −18 to −20 dB RMS, music −26 to −29 (about 9–10 dB under the VO), SFX −28 to −35.
- The new product should finish with pyloudnorm to −16 (web) or −14 (social).

**Visual audio QA:**
```
ffmpeg -i stem.wav -filter_complex "showwavespic=s=1800x160:colors=#3782F7" waves.png
ffmpeg -i mix.wav -lavfi "showspectrumpic=s=1800x500:scale=log:fscale=log" spec.png
ffmpeg -i mix.wav -af ebur128=peak=true -f null -
```

---

## 7. Deliverables (`finish.py`): exact encodes

| Output | Command essentials | Size (92.5 s) |
|---|---|---|
| Master | `libx264 -preset slow -crf 14 -profile:v high -pix_fmt yuv420p` + `aac 320k`, `+faststart`, 60 fps | 116–120 MB |
| Web / social | `-crf 21 -maxrate 9M -bufsize 18M` + `aac 192k`, 60 fps | 25.8 MB |
| Hero muted mp4 | `-an -r 30 -crf 24` | 11 MB |
| Hero muted webm | `-an -r 30 libvpx-vp9 -b:v 0 -crf 36 -row-mt 1 -deadline good -cpu-used 2` | 6.8 MB |
| Landing mp4 with audio | `-crf 24 -maxrate 5M -bufsize 10M` + `aac 128k`, 60 fps | 15 MB |
| Landing webm with audio | `libvpx-vp9 -b:v 0 -crf 37 -row-mt 1` + `libopus 112k` | 11 MB |
| Posters / thumbs | `-ss T -frames:v 1 -q:v 2` (jpg) | ~120–190 KB |
| Stems and mix | `pcm_s24le` 48 kHz | 26.8 MB each |
| Captions | SRT: line start = VO `t`, end = `t + dur + 0.25 s`; display spelling, not the TTS respelling | — |

**Web embedding lessons** (from the Acentra landing integration):

- Use `<video autoPlay loop muted playsInline preload="auto" poster=…>` with a WebM source first and an MP4 fallback.
- **React doesn't reflect `muted` to the DOM attribute.** Set `video.muted = true` in an effect before `play()`, because Safari checks the attribute for autoplay.
- Unmute button: the first unmute restarts from 0 so the viewer hears the story from the top; later toggles mute in place. Use `aria-label` "Unmute video" / "Mute video" and `aria-pressed`.
- The poster should be a product frame (we used 24.6 s), **not** frame 0, which is black because of the fade-in.
- Reference component: `acentra/apps/acentra-frontend/src/components/landing/ui/PromoVideo.tsx` plus its spec. They were created in the Acentra repo on branch `feature/landing-promo-video`; check where that branch was merged.

---

## 8. Environment used

| Item | Value |
|---|---|
| Machine | macOS (Darwin 25), Apple M1 Pro, 8 cores |
| Node | 20.17 (nvm) |
| Playwright | `@playwright/test ^1.57`, Chromium from `~/Library/Caches/ms-playwright` |
| ffmpeg | Homebrew, with libx264, libvpx-vp9, libopus, aac, libsvtav1 |
| Python | 3.13 venv: numpy 2.4, scipy, soundfile, kokoro-onnx 0.6.1, phonemizer-fork, faster-whisper |
| espeak-ng | Homebrew 1.52 |
| Fonts | `https://github.com/google/fonts/raw/main/ofl/onest/Onest%5Bwght%5D.ttf`; `…/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf`; `…/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf` |

**Not reusable:** the prototype's venv and Kokoro model files lived in a temporary session scratchpad and are gone. Recreate them with §5.1.

---

## 9. Licensing record

- **Clear for commercial use:**
  - Kokoro-82M weights and kokoro-onnx: Apache-2.0.
  - misaki: Apache-2.0.
  - Playwright: Apache-2.0.
  - faster-whisper: MIT; the Whisper weights are MIT.
  - librosa: ISC.
  - pyloudnorm: MIT.
  - Onest, Open Sans, JetBrains Mono: OFL-1.1.
- **Avoid:**
  - **Remotion**, which needs a paid company licence above 3 employees.
  - **madmom** models (CC BY-NC-SA).
  - **Essentia** (AGPL).
- **ffmpeg with libx264 is GPL.** That's fine for internal hosted use; get a review before distributing images or binaries.
- All music and SFX are synthesized in our code: original and royalty-free.
