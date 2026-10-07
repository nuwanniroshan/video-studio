# M0 spike: results

**Date:** 2026-10-08. **Branch:** `feature/m0-spike`.

**Scope:** engine port, http-served runtime with `kineticTitle`, renderer port, `docker/Dockerfile.render`, render-speed measurements, audio toolchain.

**Not done:** the Fargate run. It needs AWS access, so the procedure is written up in [`SPIKE-fargate-checklist.md`](SPIKE-fargate-checklist.md).

## TL;DR

- The pipeline works end to end: spec-like doc → localhost runtime → parallel CDP capture with tmix motion blur → concatenated H.264.
- Stills from the container and native runs match at SSIM 0.995–0.9996. Lint is clean in 16:9 and 9:16.
- **Both environments are CPU-only.** Playwright's headless shell uses SwiftShader on the Mac as well as in Docker (`ANGLE … SwiftShader driver` in both). The Mac numbers are therefore a fair proxy for Fargate's software rendering, scaled by core count and per-core speed.
- **Cinema** (1080p60, 3 sub-frames):
  - 15.5 output fps natively with 7 workers on the M1 Pro;
  - 5.6–6.4 output fps in a 4-vCPU Docker VM.
- **Projected on a 16 vCPU Fargate ARM64 task:** about 10 output fps at cinema and about 15 at standard. This is an estimate until the checklist is run.
- **Render cost on SwiftShader:**
  - big layered shadows: −27 to −39% throughput;
  - `filter: blur`: −20%;
  - 3D transforms: −10%.
- **Plan change needed (determinism):** frames are byte-identical only when each segment starts from a freshly loaded page. Details and the proposed change are in [Determinism](#determinism-plan-change-proposed).

## Environment

| | Native | Container |
|---|---|---|
| Host | Apple M1 Pro, 8 cores (6P + 2E), 16 GB | Docker Desktop VM on the same Mac, **4 vCPU / 7.7 GB** (Docker Desktop limit), linux/arm64 |
| Node / Playwright | 20.17 / playwright 1.63, `chromium_headless_shell-1243` | same versions, `node:20.17-bookworm-slim` |
| ffmpeg | Homebrew (libx264) | Debian 5.1.9 (libx264) |
| GPU | none used: SwiftShader | SwiftShader |
| Image size | — | 1.3 GB (`studio-render:spike`) |

## Test content

- **title:** an 8 s, two-scene `kineticTitle` clip.
  - Scene 1 is dark, with word rise and blur.
  - Scene 2 is light, with a mask reveal and drifting blurred orbs.
  - About 25% of its frames are static and deduplicated (121 of 480 at 60 fps).
- **plain / blur / 3d / shadow:** the `spikeStress` probe. It shows 12 cards moving for the whole clip, with no dedupe.
  - plain: no extra effects.
  - blur: `filter: blur` up to 14 px.
  - 3d: `rotateX`/`rotateY` under perspective.
  - shadow: an xl shadow plus a 120 px shadow on every card.

The title clip is lighter than the LuraPlus film (which had an app frame, dense UI and a grain canvas): the prototype measured 6.6 fps at cinema with 7 workers. Read these figures as a pipeline ceiling, not as a figure for the film.

## Results

The raw JSON lines are in `out/spike/**/*.jsonl` (gitignored). Rerun them with `scripts/spike-bench.sh <label> <workers>`.

### Quality tiers (title clip, output fps = finished video frames per wall-second)

| Tier | Scale / fps / sub | Native, 7 workers | Native, 3 workers | Container (4 vCPU), 3 workers | Container, 4 workers |
|---|---|---|---|---|---|
| draft | 0.5× / 30 / 1, JPEG q85 | **42.2** | 34.7 | 17.8 | — |
| standard | 1× / 30 / 2, PNG | **20.6** | 14.9 | 6.3 | — |
| cinema | 1× / 60 / 3, PNG | **15.5** | 10.1 | 5.2 (5.6 final engine) | 6.35 (final engine) |

Run-to-run spread on the Mac is about ±15%, from thermals: one 7-worker cinema rerun measured 11.5 fps. The "final engine" figures are explained under [Determinism](#determinism-plan-change-proposed).

### Worker scaling (cinema, title clip)

| Workers | Native output fps | Container (4 vCPU) output fps |
|---|---|---|
| 1 | — | 3.4 |
| 2 | — | 4.1 |
| 3 | 10.1 | 5.2 |
| 4 | — | 6.3 |
| 5 | 14.0 | — |
| 7 | 15.5 | — |
| 8 | 16.2 | — |

- **Native:** gains flatten after about 5 workers, which matches the 6 performance cores.
- **Container:** throughput still rises at workers = vCPU. Chromium and the libx264 encoders share the same cores.
- **Implication:** on 16 vCPU, start at **12 workers** and sweep 8–16, rather than using the PLAN's guess of 6. This is unconfirmed until Fargate is measured.

### SwiftShader cost of effects (stress probe, standard, 3 workers, 8 s, captures/s)

| Probe | Native | Relative | Container | Relative |
|---|---|---|---|---|
| plain | 23.6 | 1.00 | 13.4 | 1.00 |
| blur (≤14 px) | 18.3 | 0.78 | 10.7 | 0.80 |
| 3D transforms | 21.2 | 0.90 | 12.0 | 0.90 |
| big shadows | 17.2 | **0.73** | 8.2 | **0.61** |

The 4 s probes were dominated by Chromium startup (plain gave the same fps on 3 and 7 workers), so only the 8 s runs are used here.

**Recommendations for M1 (house style unchanged, guard rails added):**
- Keep `blur` for entrances, which are short.
- Lint-warn above 12 px of blur at 1080p, and on long-lived blur.
- Lint-warn on xl shadows applied to more than about 8 simultaneous elements.
- Prefer one shadow layer per card.
- 3D is cheap enough to use freely.
- `backdrop-filter` stays banned (PLAN §7.5).

### Projection for Fargate (16 vCPU ARM64), to be confirmed

**Assumptions:**
- Container throughput at 4 workers is 14.2 captures/s, or 3.6 captures/s per vCPU including encoding.
- Throughput scales to 16 vCPU (roughly 57 captures/s).
- A Graviton core does about 0.55× the work of an M1 Pro performance core. This is an assumption.

That gives **about 31 captures/s per task**. Per output frame, that means:

| Tier | Captures per frame | Output fps per task (no dedupe) | Notes |
|---|---|---|---|
| standard | 2 | ~15 | A 60 s 1080p30 final ≈ 2 min on one task, plus cold start. M2's target is under 10 min, so there is headroom even for scenes 3× heavier. |
| cinema | 3 | ~10 | For LuraPlus-weight scenes (about 2.3× heavier than this clip): ~4.5 fps, so a 92.5 s film ≈ 21 task-minutes, or about 6 minutes across 4 tasks. |

**Cost**, at Fargate ARM64 list prices ($0.03238 per vCPU-hour and $0.00356 per GB-hour; verify for the region):
- A 16 vCPU / 32 GB task costs **$0.63/h on-demand**, about $0.19/h on Spot.
- The LuraPlus-weight cinema film comes to about **$0.22 on-demand** or $0.07 on Spot. That's inside the PLAN's $0.10–0.40 range.

## Quality tiers: decision

Keep the PLAN §10 tiers as they are.

- **draft at 0.5×** pays off on CPU (+40% captures/s in the container; the gain is negligible natively).
- **standard** stays the default for finals.
- **cinema** is for flagship pieces.
- **Encoder:** segment CRF 8 for standard and cinema; draft uses CRF 18 because it is never re-encoded into a master.

## Determinism: plan change proposed

PLAN §14 says: *"the same frames rendered in shuffled order across two workers must produce byte-identical PNG hashes."*

**Measured** (`spike.ts determinism`, 40 frames, two browsers, opposite order):

| Engine state | Mismatched frames | Max pixel difference |
|---|---|---|
| Straight port (`translate3d`, `will-change`, `display:none` windows) | 32 / 40 | 34 / 255 (word-edge positions) |
| + 2D transforms, no `will-change` | 18 / 40 | 1 / 255 |
| + a constant filter-function list (`blur(0px)` instead of `none`) | 2 / 40 | 1 / 255 |
| + `visibility` windows; tried raster flags, software compositing, opacity caps | 2 / 40 | 1 / 255 |

Shuffled order **within one scene** gave 0 / 40 mismatches.

**Cause.** Blink and the compositor keep layout, paint and layer state across seeks. When a frame is reached from a different scene, it can rasterize 1 LSB differently from the same frame reached by its neighbours. No Chromium flag tried changes this:
- `--disable-partial-raster`
- `--disable-gpu`
- `--disable-gpu-compositing`

**What does hold.** A segment captured in increasing time order, starting from a freshly loaded page, is byte-identical regardless of what the worker rendered before (`spike.ts determinism-segment`, 60 frames):

| | afterReload | withoutReload |
|---|---|---|
| Native, 16:9 | **0** | 20–53 |
| Native, 9:16 | **0** | 20 |
| Container, 16:9 | **0** | 53 |

**Proposed smallest change:**
1. **Renderer:** reload the page and `load(doc)` at the start of every segment. Segments are 6 s at most, and the reload costs about one page load (to be measured in M1; expected under 1 s against 30–60 s of capture).
2. **PLAN §14 determinism test:** "the same **segment** rendered by two workers with different prior history produces byte-identical frame hashes". Also keep a cross-order frame test with a tolerance of 1 / 255 maximum per pixel.
3. **Golden frames:** unchanged. They are compared by SSIM.

**Engine choices that follow from this** (kept, and measured on the title clip at cinema with 3 workers natively):

| Variant | fps |
|---|---|
| 2D transforms + `visibility` windows (**kept**) | 10.2–10.3 |
| + constant filter list | 10.0 (dropped: the reload makes it unnecessary) |
| `translate3d` + `visibility` | 9.5–9.7 (dropped) |

Native 3D (`rx`/`ry`/`z` ≠ 0) still emits `translate3d`. `visibility` windows also remove pitfall 6 (`display:none` zeroing rects).

## Audio toolchain

`scripts/setup-python.sh` and `scripts/tts_smoke.py`. Package versions are pinned in `python/requirements.lock`.

| Check | Result |
|---|---|
| Kokoro load (system espeak-ng via `EspeakConfig`) | 0.84 s |
| espeak's default reading of "Lura" | `lˈʊɹɹə` ("lure-a"), the same as the prototype, so the dictionary is needed |
| IPA override line "mˈiːt lˈuːɹə plˈʌs." | 1.17 s (prototype: 1.16 s) |
| Plain line, af_heart at 0.94 | 1.98 s audio, synthesized in 0.67 s |
| faster-whisper small.en int8, numpy input at 16 kHz | Exact transcript: "Run payroll in minutes, not days." (2.5 s including model load) |

## Pitfalls found in M0 (not in REFERENCE)

1. **phonemizer-fork installed `--no-deps`** (per REFERENCE §5.1) is missing `segments`, `attrs`, `dlinfo` and `joblib`. They are now pinned in the lock file. `pip check` will still say kokoro-onnx wants `phonemizer`; that's expected, because the fork provides the module.
2. **corepack in Node 20.17** has stale npm signing keys and fails during `docker build`. The Dockerfile installs pnpm with `npm i -g` instead.
3. **tsx plus `page.evaluate`:** tsx's keep-names transform injects `__name()` into named inner functions, which then throw in the page. Keep evaluate callbacks to single expressions, or pass a string.
4. **Brand token naming:** don't split digits when converting to kebab-case. `primary400` must stay `--vs-primary400`. The first contact sheet caught this: an invisible kicker had silently fallen back to ink.
5. **Line-height 1.02 headlines** overflow their line box by design. Overflow lint now allows 0.25 em vertically, and only checks height when the box actually clips.
6. **Docker Desktop is capped at 4 CPUs** on this Mac. Raise it under Settings → Resources if you want a closer container scaling curve.

## Artifacts

All of these are in gitignored `out/`, so regenerate them with the commands shown.

| What | Path | Regenerate |
|---|---|---|
| Test clip, 16:9 cinema | `out/spike/clip-cinema-16x9.mp4` (480 frames, 1920×1080 at 60 fps) | `npx tsx packages/render/scripts/spike.ts clip out/spike/clip-cinema-16x9.mp4 cinema 7` |
| Test clip, 9:16 cinema | `out/spike/clip-cinema-9x16.mp4` (480 frames, 1080×1920 at 60 fps) | `… clip out/spike/clip-cinema-9x16.mp4 cinema 7 9:16` |
| Same clip rendered in the container | `out/spike/container/clip-cinema-16x9.mp4` | see `docker run …` in the checklist |
| Contact sheets | `out/spike/sheet-16x9.jpg`, `sheet-9x16.jpg`, `clip-sheet*.jpg` | `spike.ts stills <dir> <aspect>` |

## Open items carried into M1

- Bump portrait type scale. The sub and kicker are 25 px and 17 px on a 1080-wide frame, which is too small on phones.
- Measure the page-reload cost per segment once the segment cache exists.
- Run the Fargate checklist and replace the projection with measured numbers.
