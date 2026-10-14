# video-studio build plan

**video-studio** is a generic, code-driven motion-graphics video generator. Non-technical users work in a web studio; technical users have a CLI and a Claude Code skill.

> Companion documents:
> - [`REFERENCE.md`](REFERENCE.md) records the working prototype: exact parameters, measured numbers, every pitfall hit and every ffmpeg/TTS command. Read it before porting anything.
> - [`../AGENTS.md`](../AGENTS.md) holds the rules for agents working in this repo.

---

## 1. Context

In October 2026 we produced the **LuraPlus launch film** (92.5 s, 1080p60, voiceover, original score, sound design) entirely from code. The prototype lives at:

```
/Users/swiveltech/Disk/Swivel/acentra-platform/marketing/promo-video   (READ-ONLY reference; never edit)
```

Most of the pipeline is reusable as it stands:
- a seekable animation engine;
- a parallel Playwright renderer with true motion blur;
- local neural TTS;
- a synthesized score and sound-effects generator;
- an automatic mix;
- a deliverables encoder.

The film itself was hand-authored: about 1,600 lines of HTML/CSS/JS with absolute pixel positions and absolute timestamps, plus a music arrangement hard-coded to those timestamps. Making another video means writing all of that again.

**Goal:** a tool that makes *any* motion-graphics video from a declarative storyboard: product promos, feature launches, explainers and how-tos, social cutdowns, testimonials, announcements, and anything else via a freeform scene.

**Decisions already taken by the product owner:**

| Topic | Decision |
|---|---|
| Repo | Standalone, at `/Users/swiveltech/Disk/Swivel/video-studio` (this folder) |
| Users | Non-technical team (web UI) **and** technical users (CLI + Claude Code skill) |
| Hosting | Docker on AWS, using ECS Fargate in the same style as the Acentra CDK stack |
| AI | No LLM access yet. A pluggable provider (`none \| anthropic \| bedrock`); the tool must be fully usable without AI. |
| Auth | Simple shared login (users and passwords from a secret) |
| First templates | Product promo, Feature launch, Explainer/how-to, Social cutdowns, plus "anything else" via freeform |

**Non-goals:**
- Photoreal or generative video.
- NLE-style free-form timeline editing.

User-supplied media (images, screenshots, logos, clips, music, human VO) is supported, and Playwright can capture real web-app flows.

---

## 2. Architecture

```
Browser SPA ──ALB (host rule on existing ALB)──> studio-web  (ECS Fargate service, always on, ARM64, 2 vCPU / 4 GB)
  │                                               ├─ Fastify: API, auth, static SPA, /runtime player bundle
  │  <iframe src="/runtime"> live preview         ├─ orchestrator: pg-boss queue, ecs:RunTask, SSE progress
  │  (the same bundle the renderer captures)      └─ sidecar container "vsaudio" (FastAPI on localhost:8090):
  │                                                    TTS, music analysis, arrange/mix, whisper QA
  └─ SSE progress  <──────────────  studio-render tasks (ECS RunTask, ephemeral, 16 vCPU / 32 GB, Spot first)
                                    Node + Playwright Chromium + ffmpeg; pull segment jobs, exit when the queue is empty
Postgres (projects, immutable spec revisions, assets, jobs; pg-boss tables)    S3 (assets/, brands/, cache/, renders/)
```

**Two images.** Both share a base layer with Chromium, ffmpeg and fonts.

| Image | Contents | Notes |
|---|---|---|
| `studio-web` | Node 20, Python 3.12 venv (vsaudio), Kokoro models baked in, espeak-ng (apt), ffmpeg, Chromium | Chromium is used for stills, analysis and layout lint only |
| `studio-render` | Node 20, Playwright Chromium, ffmpeg | Slim, for faster Fargate cold starts. Add a SOCI index. |

**Database and queue.**
- Postgres with **pg-boss** gives one dependency for both data and queue.
- In production: either a new database on the existing Acentra RDS instance or a `db.t4g.micro`.
- In local development: `docker-compose` with Postgres, MinIO (S3) and an in-process worker in place of RunTask.

**Auth.**
- Secrets Manager holds `STUDIO_USERS` as JSON `{ "username": "<bcrypt hash>" }`.
- Login uses `@fastify/cookie` with a signed, httpOnly, SameSite=Lax session cookie and a 12 h expiry.
- There is no user table in v1. `created_by` stores the username.

---

## 3. Repo layout

pnpm workspaces plus turborepo. TypeScript everywhere except audio (Python).

```
video-studio/
  apps/
    web/          Vite + React 19 + TanStack Query + MUI (or Tailwind): studio UI
    server/       Fastify API, auth, orchestrator, serves SPA + /runtime
    worker/       render task entrypoint: segment, assemble, flow-capture jobs
    cli/          `vs` CLI (commander): init, validate, dev, stills, render, scenes, brand
  packages/
    spec/         zod v4 schemas + JSON Schema export + migrations (v1→vN)
    timing/       pure resolver: spec + VO durations + beat grid → ResolvedTimeline
    engine/       TS port of the prototype engine (instance-based, scoped, indexed)
    runtime/      player bundle: mount scenes, seek, markers, layout lint, postMessage API
    scenes/       scene modules, transitions, UI kit, overlays, motion helpers
    brand/        brand-kit schema → CSS custom properties + @font-face
    render/       Playwright capture, segment cache, ffmpeg wrappers, deliverables
    ai/           LlmProvider interface: none | anthropic | bedrock (stub until access)
    storage/      S3 / local FS abstraction, content addressing (sha256)
  python/vsaudio/
    tts/          kokoro-onnx + misaki G2P + brand pronunciation dictionary + cache
    score/        dsp.py, instruments.py, sfx.py, arranger.py, presets/*.yaml
    analyze/      librosa beat tracking for uploaded music
    mix/          ducking, bus automix, loudness (pyloudnorm), stems
    qa/           faster-whisper transcription with word timestamps
    server.py     FastAPI sidecar; also a CLI entry (`python -m vsaudio …`)
  templates/      product-promo/, feature-launch/, explainer/, social-teaser/, testimonial/, announcement/, blank/
  brands/         example brand kits (luraplus/)
  examples/       luraplus/ (acceptance test: rebuild of the original film)
  infra/          AWS CDK (TypeScript)
  docker/         Dockerfile.web, Dockerfile.render, docker-compose.yml
  tests/golden/   golden frames per scene × aspect × fixture
  .claude/skills/video-studio/SKILL.md
  docs/           PLAN.md, REFERENCE.md, scene catalog (generated)
```

---

## 4. Reuse map: port, don't rewrite

All source paths are relative to `/Users/swiveltech/Disk/Swivel/acentra-platform/marketing/promo-video/`. Copy files in, then refactor. [`REFERENCE.md`](REFERENCE.md) has the parameter details.

| Prototype file | Destination | Keep | Change |
|---|---|---|---|
| `src/engine.js` (260 lines) | `packages/engine` | Easing set (bezier solver, `out`, `inOut`, `smooth`, `soft`, `back`, `spring`); prop model (`x y z s sx sy r rx ry o blur bright sat w h pct dash clipX clipY clipR`); transform/filter composition; `fn` with `key` groups; `revealWords`, `type`, `count`; xorshift `rand` | Instance API `createTimeline()`; `tl.scope(offset)` so scenes author at local t=0; per-scene channel sets; evaluate only active scenes; binary-search segments; seeded RNG per scene id; `emit(kind,t,data)` for SFX markers; `activity(t)` so static frames can be detected; TypeScript types |
| `src/scenes.js` helpers (`paneIn/Out`, `copyIn/Out`, `pop`, `press`, `click`, `curShow/curMove/curHide`, `placeRipple`, `dim`, `sweep`, `at`, `rel`) | `packages/scenes/motion.ts` | Timings and eases as the house style | Take a scoped timeline plus a stage-unit scale |
| `src/scenes.js` and `src/index.html` scene bodies | `packages/scenes/*` (M3) | Visual designs: legacy-window chaos, logo reveal with sheen and flare, app frame with sidebar pill and crumb, pop-out cards, kanban drag, org chart, leave live-checks, timesheet grid, dual-blind reviews, calibration histogram, reports charts, hub pull-back, trust cards, roadmap line, CTA end card | Data-driven props, cue-based timing, measured layout, per-aspect presets |
| `src/styles.css` | `packages/scenes/styles` + `packages/brand` | Primitives (`card chip btn av ico bar-track kcard tbl stat field check-row cursor ripple`), grain/vignette, grids | Every colour and font becomes a brand CSS variable. Grain and vignette move to the ffmpeg post-pass. |
| `render.mjs` (118 lines) | `packages/render` | One Chromium **per worker**; CDP `Page.captureScreenshot {format:'png', optimizeForSpeed:true}`; PNG `image2pipe` into ffmpeg; sub-frame motion blur via `tmix` + `select`; segment encode CRF 8; concat copy | Serve the runtime over `http://127.0.0.1:<port>` and block every other origin with `page.route('**')`, which removes `file://` and `--allow-file-access-from-files`. Segment cache. Static-frame dedupe. Quality tiers. Progress callbacks. Cancellation. |
| `audio/gen_vo.py` | `python/vsaudio/tts` | kokoro-onnx; silence trim; `is_phonemes` overrides; `EspeakConfig` with system espeak-ng | misaki G2P; brand pronunciation dictionary; content-hash cache; durations returned to the resolver |
| `audio/score.py` (600 lines) | `python/vsaudio/score/*` | dsp (`lp hp bp sweep_lp env_adsr saw`), instruments (`pad ks bell kick clap hat tick bass_note`), sfx (`riser impact whoosh pop click_sfx chime`), `reverb_ir`/`reverb`/`delay`, sidechain, per-bus automix, `duck_curve` | Arranger driven by the resolved timeline (scene `musicCue`, transition hits, runtime SFX markers) plus YAML mood presets. The LuraPlus score becomes the `uplifting-tech` preset. |
| `finish.py` | `packages/render/deliverables.ts` | Exact encode ladders (see REFERENCE §7), SRT from VO timings, posters, stems | VTT too; per-variant outputs; S3 upload |
| `timeline.json` | `packages/timing` output | Shape `{fps,width,height,bpm,duration,scenes[],vo[]}` | Becomes a superset: `ResolvedTimeline` |
| `audio/vo_script.json` | spec `vo[]` + brand dictionary | `phonemes` override field | Per-brand dictionary instead of per-line IPA |
| `fonts/*.ttf` (Onest, Open Sans, JetBrains Mono; OFL) | `brands/luraplus/fonts`, plus default fonts in `packages/brand` | as is | |
| `README.md` (story, script, shot list) | `examples/luraplus/BRIEF.md` | The creative template for "product promo" | |
| `/Users/swiveltech/Disk/Swivel/acentra-platform/acentra/infrastructure/lib/constructs/ecs-construct.ts` | `infra/lib/*` | Cluster, ALB, ECR, log groups, secrets pattern | A web service plus a RunTask-only render task definition; a host rule on the existing ALB |

---

## 5. Storyboard spec (`packages/spec`)

### 5.1 Top level

```jsonc
{
  "version": 1,
  "title": "Payroll launch",
  "brand": "luraplus",                       // brand-kit id
  "fps": 60,
  "quality": "standard",                     // draft | standard | cinema (overridable per render)
  "music": { "mode": "preset", "preset": "uplifting-tech", "bpm": 96, "key": "D" },
          // | { "mode": "upload", "asset": "sha256:…", "bpm"?: 120, "downbeatOffset"?: 0.0 } | { "mode": "none" }
  "voice": { "provider": "kokoro", "voice": "af_heart", "speed": 0.94 },   // | { "provider": "upload" } (per-line assets)
  "timing": { "snap": "bar", "leadIn": 0.45, "lineGap": 0.35, "tail": 0.6 },  // snap: bar | beat | none
  "variants": [
    { "id": "main",   "aspect": "16:9" },
    { "id": "social", "aspect": "9:16", "scenes": ["hook","feature","cta"], "maxDuration": 30,
      "captions": "burned", "safeArea": "reels",
      "overrides": { "feature": { "vo": [{ "text": "Payroll, done in minutes." }] } } }
  ],
  "scenes": [ /* Scene[] */ ]
}
```

### 5.2 Scene

```jsonc
{
  "id": "feature",
  "type": "featureSpotlight",                // module id from the scene registry
  "tone": "light",                           // light | dark | brand (drives the background layer)
  "transitionIn": { "type": "push", "duration": 0.6, "direction": "up" },
  "musicCue": "groove",                      // tension | build | reveal | groove | breath | resolve (default from module)
  "duration": { "mode": "auto", "min": 4 },  // | { "mode": "fixed", "seconds": 6 }
  "vo": [ { "id": "v1", "text": "Run payroll in minutes.", "asset"?: "sha256:…" } ],
  "props": { /* validated by the module's zod schema */ },
  "aspectOverrides": { "9:16": { "props": { "layout": "stacked" } } }
}
```

### 5.3 Schema conventions

- Every module exports `schema: z.object(...)`.
- Each field carries `.meta({ ui, label, help, maxChars, group })`, where `ui` is one of `text | richText | number | color | asset | assetList | list | select | toggle | hotspots | cursorPath | focusRect | uiKit`. The web inspector generates its forms from this.
- `z.toJSONSchema()` produces `docs/schema.json` for the CLI, the skill and the future AI prompt.
- `maxChars` is enforced in the UI and checked by layout lint at render time.
- Every saved edit is an **immutable revision** (JSONB) with `spec.version` set. `migrate()` runs on load.

---

## 6. Timing resolver (`packages/timing`)

A pure function with property tests:

```
resolve(spec, variant, voDurations: Map<voId, seconds>, grid: { bpm, beats?: number[], offset }) → ResolvedTimeline
```

1. **Scene order and inclusion.** Apply the variant's scene list and overrides.
2. **Step and scene body length.** `body = max(module.timing(props).min, leadIn + Σ(voDur_i) + lineGap·(n-1) + tail)`. Multi-step modules such as appTour, steps and featureGrid report per-step minimums, and VO lines bind to steps.
3. **Snap.** Each scene's *end* rounds **up** to the next bar or beat on the grid. For uploaded music the grid comes from detected beats; otherwise from `60/bpm`.
4. **Transitions** overlap the boundary symmetrically (`d/2` each side) and are clamped to 40% of the shorter neighbour.
5. **VO placement.** The first line starts at `scene.start + leadIn`, and each next line at `prev.end + lineGap`.
6. **`maxDuration`** for variants: drop scenes marked `optional` first, then shorten `tail`, then fail with a clear error.
7. **Output:**

```
{
  duration, fps, aspect, beats[],
  scenes: [{
    id, start, end,
    steps: [{ start, end }],
    vo: [{ id, t, dur }],
    transitionIn: { type, start, end },
    cues: { [name]: t }
  }]
}
```

**Rule:** scenes animate against **cues** (`ctx.vo[0].t`, `ctx.steps[1].start`, `ctx.end`), never absolute seconds. The prototype had to hand-align visuals to VO lines; for example, line L14 had to be reworded so its order matched the visuals. Cues make that automatic.

---

## 7. Runtime and scene system

### 7.1 Stage and aspect ratios

| Aspect | Stage (px) | Orientation |
|---|---|---|
| 16:9 | 1920×1080 | landscape |
| 9:16 | 1080×1920 | portrait |
| 1:1 | 1080×1080 | square |
| 4:5 | 1080×1350 | portrait |

- The stage is a CSS container (`container-type: size`) carrying `data-orient`. Scenes size type and spacing in `cqmin`, and pick a **layout preset** per orientation, for example featureSpotlight: `split-left | split-right | stacked | visual-only`.
- Positions are **measured after mount** (`getBoundingClientRect`, before the first seek, as the prototype's `rel()` did) and never hard-coded.
- `fitText(el, {min, max})` binary-searches font size at mount.
- **Focus camera:** each product-UI step can declare a normalized `focus` rect. Portrait variants zoom the frame to it; landscape stays wide.
- **Safe areas:** Reels/TikTok/Shorts overlays exist as preview-only guides, and lint fails if text falls outside them.

### 7.2 Scene module interface

```ts
export interface SceneModule<P> {
  type: string; version: number; schema: ZodType<P>;
  meta: { label: string; category: 'title'|'product'|'feature'|'proof'|'structure'|'media'|'close'|'custom';
          description: string; thumbnail: string; defaultMusicCue: MusicCue; defaultTransition: TransitionSpec };
  timing(props: P, ctx: TimingCtx): { min: number; steps?: { min: number }[] };
  mount(root: HTMLElement, props: P, ctx: MountCtx): Promise<void>;  // build DOM, load/decode assets, fitText
  animate(tl: ScopedTimeline, props: P, ctx: AnimCtx): void;          // register tweens against ctx cues; tl.emit() SFX
  anchors?(): Record<string, HTMLElement>;                             // for morph transitions
}
```

### 7.3 Transitions

Each transition is a module: `apply(outRoot, inRoot, tl, t0, d, params)`.

- **Set:** cut, crossfade, blurDissolve, push or slide (four directions), wipe, iris (the prototype's `clipR` circle), zoomThrough, flash/impact (the prototype's 14.86–15.9 s white flash), and morph.
- **Morph** uses FLIP between anchors, as in the prototype's app frame shrinking into the hub.
- Every transition emits a `whoosh` or `impact` SFX marker.

### 7.4 Global layers

- **Background:** follows the scene `tone`, crossfading between the dark navy gradient with grid and the light grey with grid, orbs and vignette.
- **Overlays:** captions (word-level, from whisper timestamps or estimated), lower third, logo bug and chapter label.
- **Grain and vignette:** applied in the **ffmpeg post-pass** (`noise=alls=…:allf=t`, `vignette`), not the DOM, so static-frame dedupe works.

### 7.5 Determinism guards

These are injected by the runtime:
- seeded `Math.random`, frozen `Date.now()`;
- `*{animation:none!important;transition:none!important}`;
- `await document.fonts.ready` and `img.decode()` before `ready`;
- user video clips pre-transcoded to JPEG frame sequences at stage fps and swapped by `t` (the preview uses `<video>`);
- no `backdrop-filter` (expensive on CPU-only Fargate).

### 7.6 Layout lint

After mount, the runtime reports:
- text overflow;
- elements outside the safe area;
- missing assets;
- props whose value exceeds `maxChars`.

These appear as badges in the UI, and the CLI prints them. Renders refuse to start on errors, but warnings are allowed.

### 7.7 Player API (iframe `postMessage`)

`load(spec, variant)`, `seek(t)`, `play()`, `pause()`, `getTimeline()`, and the events `ready`, `lint`, `markers`.

The renderer uses the same bundle through `window.__vs.seek(t)`.

---

## 8. Scene library

### 8.1 Scene types (20)

| # | Type | Used for | Prototype source to mine |
|---|---|---|---|
| 1 | `kineticTitle` (rise / mask / typewriter / scale; kicker + headline + sub) | hooks, act titles | `copyIn`, `revealWords`, `probH1` |
| 2 | `logoReveal` (blur-in, sheen sweep, flare line, glow, tagline) | brand moments | 15–20 s reveal |
| 3 | `painPoints` (list, or a "chaotic windows" variant with legacy windows, toasts and a collapse) | the problem act | 0–15 s chaos act |
| 4 | **`appTour`** (persistent app/browser frame, sidebar nav pill, breadcrumb, steps with screenshot or UI-kit panes, callouts, cursor path/clicks/typing/drag, pop-out cards with content dimming, focus camera, gentle 3D sway) | flagship product scenes | 20–68 s product act |
| 5 | `screenFlow` (flow-capture screenshots + synthetic cursor between recorded element boxes + zooms) | how-tos | new |
| 6 | `deviceMockup` (phone / laptop / tablet, 3D tilt, image or clip) | mobile features | new |
| 7 | `featureSpotlight` (copy + visual split) | feature launches | the copy column plus pane |
| 8 | `featureGrid` (2–6 items, icon + title + line) | overviews | trust cards |
| 9 | `uiShowcase` (one UI-kit component, full stage) | data stories | report charts |
| 10 | `statsCounter` | proof | `count()`, the dashboard pulse strip |
| 11 | `comparison` (before/after slider; us-vs-them table) | positioning | new |
| 12 | `quote` / testimonial | social proof | new |
| 13 | `logoWall` / marquee | customers, integrations | new |
| 14 | `steps` / howTo (numbered, progress line, optional screenshot) | explainers | leave and perf steppers |
| 15 | `roadmap` / timeline | "more on the way" | 75–80 s scene |
| 16 | `hubDiagram` (nodes connected to a centre) | "one source of truth" | 66–68 s pull-back |
| 17 | `trustCards` / iconChecklist | security, benefits | 68.75–75 s scene |
| 18 | `mediaBroll` (Ken Burns, duotone tint, text overlay) | user images and clips | new |
| 19 | `ctaEndCard` (logo, headline, button with cursor click, URL, optional QR) | the close | 80–92.5 s scene |
| 20 | `freeform` (declarative layer tree with JSON keyframes) | anything else | new |

### 8.2 UI kit

Data-driven components that use brand tokens; each mirrors a prototype component:

- **Lists, forms and boards:**
  - list (Needs-you queue);
  - form with typing fill (AI job post, leave form);
  - kanban with drag;
  - table (timesheet grid);
  - stat tile (pulse strip).
- **Charts:** bar, line/area, donut, funnel and histogram with target curve, all from the reports and calibration scenes.
- **Calendar or week grid:** leave calendar.
- **Cards and panels:**
  - profile card;
  - toast;
  - chat bubble;
  - AI panel (skeleton shimmer, then result; from the AI overview);
  - live-check list (spinner, then green check);
  - stepper;
  - score dial;
  - org chart (SVG elbows that draw on).

### 8.3 Freeform (the main AI escape hatch, and safe)

```jsonc
{ "layers": [
    { "id":"t1", "kind":"text", "text":"…", "style":{ "font":"display", "size":8, "color":"brand.primary" }, "box":[0.1,0.3,0.8,0.2] },
    { "id":"i1", "kind":"image", "asset":"sha256:…", "box":[…], "fit":"cover" },
    { "id":"s1", "kind":"shape", "shape":"rect|circle|line|path", "fill":"…", "box":[…] },
    { "id":"u1", "kind":"ui", "component":"kanban", "props":{…}, "box":[…] } ],
  "keyframes": [ { "layer":"t1", "at":"vo.v1", "dur":0.9, "from":{ "y":40, "o":0, "blur":8 }, "ease":"out" } ] }
```

- Boxes are normalized to the stage.
- `at` accepts a cue name or a number of seconds of local time.
- It compiles to engine `tw` calls and contains **no code**.
- **Code-scene plugins** (raw JS) can be added only through the repo with PR review. They are never accepted from the web UI in v1.

**Amended (user request, Oct 2026): `compose` implements freeform.** Agent videos all looked like the templates because every
scene came from the fixed library and the agent prompt hard-coded one structure. `compose` (`packages/spec/src/scenes/compose.ts`,
`packages/scenes/src/compose.ts`) is the freeform scene with motion *presets* instead of raw keyframes, which keeps it easy for
an LLM to write and for the editor to show:

- Layers: `text` (7 styles), `shape`, `svg` (agent-drawn vector art; allowlisted elements, no scripts/styles/images/external refs,
  checked in the schema and stripped again in the runtime), `image`, `logo`, `icon`, `particles` (8 deterministic closed-form
  styles) and `counter`. Positions are % of the variant's safe frame, with `portrait`/`square` placement overrides.
- Each layer enters at a cue (`start`, `end` or a VO line id, plus `delay`) with one of 17 entrances, can leave at an `until`
  cue and can have one idle loop. Unknown cues fall back to the scene start and raise an `unknown-cue` lint warning.
- Default text colours follow the measured background luminance, not just `tone`, so custom backgrounds stay readable.
- The agent has two modes: **original** (no template; it writes a creative direction first and builds mostly from `compose`,
  free to choose tones, transitions and the close) and **template** (keeps the template's structure and the house pattern).
  With "Designed for my idea" branding the agent also sets the palette, fonts and music (`set_brand`); without an agent a theme
  is guessed from the idea's keywords (`guessTheme`).

---

## 9. Audio (`python/vsaudio`, JSON in, files out)

### 9.1 TTS

**Engine.** kokoro-onnx (Kokoro-82M, Apache-2.0).
- Default voice `af_heart` at speed 0.94.
- 54 voices available; the UI offers about 10 curated ones.

**Grapheme-to-phoneme (G2P) conversion.** Use misaki (Apache), with espeak-ng from apt in Docker, or Homebrew on a Mac.

**Brand pronunciation dictionary:**
```
{ "Lura": { "ipa": "lˈuːɹə" }, "SaaS": { "respell": "sass" }, "AI": { "respell": "AI" } }
```
- Terms are spliced into the phoneme stream.
- Captions keep the original spelling.

**Cache.**
- Key: `sha(text, voice, speed, dict entries used, model version)`.
- Output: a trimmed 24 kHz WAV plus its duration. Durations feed the resolver.

**Human VO.** An uploaded WAV per line overrides TTS. It is trimmed, normalized and measured.

**QA.** faster-whisper `small.en` with word timestamps, used to:
- flag mismatched lines;
- drive karaoke captions.

> Whisper is unreliable on invented brand names (see REFERENCE §5.5): it heard "Lura" as "Lyra" or "Laura" depending on context. **Exclude dictionary terms** from mismatch scoring. Offer a "Play line" button for human ears instead.

### 9.2 Music

**Mood presets (YAML).** A preset defines:
- key and BPM;
- chord loops per section kind (`tension | build | reveal | groove | breath | resolve`);
- an instrument palette;
- bus RMS targets;
- risers, impacts and fills policy.

| Preset | Character |
|---|---|
| `uplifting-tech` | The LuraPlus score: D major, 96 BPM, I–V–vi–IV, Bm/G tension intro |
| `calm-explainer` | — |
| `energetic-social` | 120 BPM |
| `warm-corporate` | — |
| `minimal-ambient` | — |
| `dark-to-bright` | — |

**Arranger.**
- Maps resolved scenes to bars using each scene's `musicCue`.
- Places a riser to end exactly on `reveal`/`impact` transitions, an impact on hit transitions, a "breath" bar with no kick before big camera moves, a fill or snare roll before section changes, and the final hit on the CTA click marker.
- Generates SFX (clicks, pops, chimes, typing ticks, whooshes) from **runtime markers**, collected by a headless "analyze" pass that runs `seek` across the timeline and records `tl.emit` calls.

**Uploaded music.**
- Beats and BPM come from librosa `beat.beat_track` (ISC).
- Downbeat phase is set by a heuristic and can be nudged in the UI.
- The track is trimmed and faded on a bar boundary to fit the length.
- Ducking is the same as for synthesized music.
- **Avoid madmom** (its models are CC BY-NC-SA) **and Essentia** (AGPL).

### 9.3 Mix

These numbers are proven in the prototype; see REFERENCE §6.4.

- **Per-bus automix.** Each bus is measured over its active region, then set to its target RMS (dB): pads −21, arps −25, keys −29, bass −23, drums −22.5, fx −24.
- **Music level.** Pre-duck, music sits at `VO_rms − 5 dB`. During speech, it ducks a further 6.5 dB (attack 40 ms, release 450 ms, VO gate 0.02). The result is about 9–10 dB under the voice.
- **Sound effects:** `VO_rms − 9 dB`, half-ducked.
- **Bus glue:** `tanh(1.1x)/1.1`. Normalize to a −1 dBFS peak, then apply pyloudnorm to −16 LUFS for web or −14 LUFS for social.
- **Outputs:** stems for music, sfx and vo, plus the mix, all 48 kHz / 24-bit.

---

## 10. Render pipeline (`packages/render` + `apps/worker`)

1. **Resolve** (web). Validate and migrate the spec, then hash assets. Run TTS and music analysis (both cached), then compute the `ResolvedTimeline`.
2. **Analyze.** One headless Chromium pass collects SFX markers, layout-lint results and **static intervals** (from `tl.activity(t)`).
3. **Audio**, in the sidecar and in parallel with step 4: arrange, mix and write stems.
4. **Segments.**
   - **Unit:** a scene body, a transition window, or a slice of at most 6 s.
   - **Cache key:** `sha(runtime@ver, scene type@ver, resolved props, asset hashes, brand tokens, aspect, quality, local range, neighbour ids for transitions)`.
   - Cache hits are copied from `cache/seg/<hash>.mp4`. Misses are enqueued, and the orchestrator calls RunTask for `ceil(misses/8)` tasks, capped at 4.
   - **Capture**, per REFERENCE §4:
     - one Chromium per worker process;
     - CDP PNG with `optimizeForSpeed`;
     - sub-frame times `t = i/fps + (k/sub)·(shutter/fps) − shutter/(2·fps)` with shutter 0.5;
     - ffmpeg `tmix=frames=sub, select='eq(mod(n,sub),sub-1)', setpts=N/(fps*TB)`;
     - libx264 CRF 8, closed GOP, fixed parameters, so segments concatenate by stream copy.
   - **Static frames** are captured once and duplicated with no sub-frames.
5. **Assemble.**
   - Concatenate the segments.
   - Run the post-pass (grain and vignette), then mux the audio.
   - Produce the deliverables: master, web, hero loop (mp4 + webm), landing-with-audio (mp4 + webm), SRT/VTT, posters and thumbnails, stems. Exact ladders are in REFERENCE §7.
   - Upload, then notify over SSE.

**Quality tiers:**

| Tier | Scale | fps | Sub-frames | Capture | Use |
|---|---|---|---|---|---|
| draft | 0.5× | 30 | 1 | JPEG q85 | share previews |
| standard | 1× | 30 | 2 | PNG | normal finals |
| cinema | 1× | 60 | 3 | PNG | flagship (what LuraPlus used) |

- **Progress:** `render_tasks.frames_done` is pushed over SSE as percent and ETA.
- **Cancel:** a DB flag that workers check between frames, followed by `ecs:StopTask`.
- **Concurrency:** about 6 Chromium workers per 16 vCPU task; tune this in M0.

**Storage (S3 prefixes):**
- `assets/<sha256>`
- `brands/<id>/`
- `projects/<id>/revs/`
- `cache/{vo,music,seg}/`
- `renders/<renderId>/`

Lifecycle rules: `cache/` expires after 30 days, draft renders after 14.

**Security:**
- The runtime is served only over localhost with route blocking.
- SVG uploads are sanitized (DOMPurify) or rasterized.
- Flow capture runs only on render tasks in an egress-restricted security group with a domain allow-list.
- Each task's IAM role is scoped to its job prefix.

---

## 11. Web studio (non-technical first)

**Screens:**

1. **Login.**
2. **Projects:** grid with thumbnail, last render and status; duplicate, archive.
3. **New project:** pick a template, then a brand kit, then formats (16:9, 9:16, 1:1, 4:5). An "AI brief" tab is visible but disabled until a provider is configured.
4. **Storyboard editor**, in three panes:
   - **Left:** scene cards with thumbnail, duration chip, VO snippet and lint badges. Drag to reorder. "+ Scene" opens a gallery with animated previews.
   - **Centre:** the live preview iframe (runtime) with play/scrub and a variant/aspect switcher. Below it, a timeline strip shows scene blocks, VO blocks, beat ticks and the music waveform, with a draft audio mix.
   - **Right:** an inspector auto-generated from zod meta:
     - asset picker or upload; brand-palette colours; list editors;
     - a **hotspot editor**: click on a screenshot to place callouts, draw the cursor path and click points, and set the focus rect;
     - VO text with "Play line" and pronunciation warnings;
     - transition, music cue and per-aspect overrides.
5. **Assets:** uploads (images, SVG, video, music, logos, fonts, human VO) and a **Capture web flow** wizard. Enter a URL and steps (click, type, wait, scroll); the system returns screenshots plus element boxes.
6. **Brand kits:** logo variants, colour tokens, fonts (with an "I have the licence" checkbox), voice and speed, a pronunciation dictionary with test playback, default music preset, caption style, CTA URL.
7. **Renders:** queue with progress, ETA and cancel; downloads grouped per variant; presigned share links.

**API (Fastify, JSON):**

| Area | Endpoints |
|---|---|
| Auth | `POST /api/login`, `POST /api/logout` |
| Projects | `GET/POST /api/projects`, `GET/PATCH /api/projects/:id`, `POST /api/projects/:id/revisions`, `GET /api/projects/:id/revisions/:rev` |
| Templates and scenes | `GET /api/templates`, `GET /api/scenes` (catalog with JSON Schemas) |
| Brands | `GET/POST/PATCH /api/brands`, `POST /api/brands/:id/test-voice` |
| Assets | `POST /api/assets` (multipart, returns sha), `POST /api/flow-captures` |
| Audio | `POST /api/tts/preview` (one line → WAV), `POST /api/resolve` (spec → ResolvedTimeline + lint) |
| Renders | `POST /api/renders {projectId, rev, variants, quality}`, `GET /api/renders/:id`, `GET /api/renders/:id/events` (SSE), `POST /api/renders/:id/cancel` |
| AI | `POST /api/ai/storyboard` returns 501 until a provider exists |

**Tables:**

| Table | Columns |
|---|---|
| `projects` | id, title, brand_id, created_by, created_at, current_rev |
| `revisions` | project_id, rev, spec jsonb, created_by, created_at |
| `brands` | id, name, kit jsonb |
| `assets` | sha, kind, mime, bytes, meta jsonb, created_by |
| `renders` | id, project_id, rev, variants, quality, status, progress, outputs jsonb, error, timestamps |
| `render_tasks` | id, render_id, segment_hash, status, frames_done, frames_total, worker_task_arn |

pg-boss manages its own schema.

**CLI (`vs`):**

| Command | Purpose |
|---|---|
| `vs init --template feature-launch --brand luraplus` | Start a project |
| `vs validate spec.json` | Validate a spec |
| `vs dev` | Local studio and preview |
| `vs stills spec.json --at 3.2,12 --variant social` | Quick visual QA (the prototype's contact-sheet workflow) |
| `vs render spec.json --variant main,social --quality cinema` | Render |
| `vs scenes --json` | List scenes with their schemas |
| `vs brand import <dir>` | Import a brand kit |

**Claude Code skill (`.claude/skills/video-studio/SKILL.md`).** It documents:
- the spec schema and scene catalog;
- the workflow: brief → spec → `vs validate` → `vs stills` → inspect the contact sheet → iterate → `vs render`;
- the brand dictionary;
- the house style (REFERENCE §3).

Technical users get AI authoring today through Claude Code, with no API key.

**Amended during M2 (user request, Oct 2026):** an agent provider was pulled forward. `packages/ai` has `claude-code`, which runs the
local Claude Code CLI headlessly against the `video-studio` MCP server (the user's own login; no API key). It writes and revises
storyboards and checks contact sheets. Without it, new projects get a rule-based draft (`ideaToBrief` → `briefToSpec`). Brand kits
also changed: every project owns its brand (`<project>/brand/`, preferred by the renderer over `brands/<id>`), started from a
theme (`themes/*.json`) or the user's own logo, colours and fonts. The `anthropic` and `bedrock` providers below remain M4.

**AI provider (`packages/ai`, M4):**
```
interface LlmProvider { storyboard(brief, catalog, brand): Promise<Spec>; rewriteVo(lines, targetSec): Promise<string[]> }
```
- Implementations: `none` (501), `anthropic` (Claude API, `claude-opus-5-5`), `bedrock`.
- A validation-repair loop feeds zod errors back, at most 2 rounds.

---

## 12. Infrastructure (`infra/`, AWS CDK, TypeScript)

Mirror Acentra's `infrastructure/lib/constructs/ecs-construct.ts` style: ECR, cluster, log groups and Secrets Manager.

**Resources:**
- **ECR:** `studio-web` and `studio-render` repos.
- **Web service:** Fargate on ARM64, 2 vCPU / 4 GB, two containers (`web`, `vsaudio`), with a host-header rule on the existing ALB (e.g. `studio.luraplus.io` or an internal domain).
- **Render task definition:** 16 vCPU / 32 GB, ARM64, launched via `RunTask` with a FARGATE_SPOT capacity provider and on-demand fallback. The web task role is allowed `ecs:RunTask`, `ecs:StopTask` and `iam:PassRole`.
- **S3 bucket** `video-studio-<env>` with lifecycle rules, plus VPC endpoints for S3 and ECR.
- **Render subnet security group:** egress only to the VPC endpoints, plus a domain allow-list proxy for flow capture.
- **Postgres:** a new database on the existing RDS instance, or a `db.t4g.micro`.
- **Secrets:** `STUDIO_USERS`, `SESSION_SECRET`, `DATABASE_URL`, and later `ANTHROPIC_API_KEY` or Bedrock IAM.

**Cost estimate (to be validated in M0):**

| Item | Estimate |
|---|---|
| Web task | ~$57/mo |
| ALB | $0 extra with a host rule on the existing ALB |
| Render task | ~$0.63/h on-demand, ~$0.20/h on Spot |
| 90 s cinema render | ≈ 25–40 CPU-min, about $0.10–0.40 |
| 100 finals/month | under $40 |

---

## 13. Milestones

**M0: spike (2–3 days).** Build `Dockerfile.render` and port the engine plus one scene (kineticTitle) to the http-served runtime.
- Run on Fargate ARM64 with 16 vCPU and record capture fps at draft, standard and cinema. The M1 Pro baseline is 6.6 output fps at 1080p60 with 3 sub-frames and 7 workers (REFERENCE §4.3).
- Measure SwiftShader cost for `filter: blur`, 3D transforms and big shadows.
- **Output:** a numbers table in `docs/SPIKE.md`, the final quality tiers, and confirmed workers-per-task and cost figures.

**M1: spec to video via CLI and skill (3–4 weeks).**
- Scope:
  - `packages/spec`, `timing`, `engine`, `runtime`, `brand`, `render` (local FS cache), `vsaudio` (TTS with dictionary; the `uplifting-tech` and `calm-explainer` presets; mix);
  - deliverables, CLI and skill;
  - 8 scenes: kineticTitle, logoReveal, featureSpotlight, featureGrid, screenFlow, statsCounter, mediaBroll, ctaEndCard;
  - 5 transitions: cut, crossfade, push, iris, flash;
  - the `feature-launch` template and the `luraplus` brand kit.
- **Acceptance:**
  - A 45 s feature-launch video renders in 16:9 and 9:16 with zero lint warnings.
  - Editing one scene's text re-renders only that scene's segments, in under 25% of a full render.
  - The golden and determinism suites are green.
  - The audio is −16 ±1 LUFS.

**M2: web studio on AWS (3–4 weeks).**
- Scope:
  - server and auth, Postgres/pg-boss, S3 storage, templates;
  - storyboard editor with auto-forms and the hotspot editor;
  - live preview with draft audio, brand kits, render queue (RunTask workers, SSE, cancel, downloads);
  - CDK stack; `LlmProvider` stub.
- **Acceptance:**
  - A non-technical teammate makes a 30 s video from a template in under 20 minutes, unaided.
  - A 60 s 1080p30 final completes in under 10 minutes wall time.
  - Render tasks have no egress beyond the S3 and ECR endpoints.

**M3: pro library and audio (~4 weeks).**
- Scope:
  - appTour with the full UI kit and focus camera;
  - painPoints, hubDiagram, roadmap, comparison, quote, logoWall, steps, trustCards, deviceMockup, uiShowcase, freeform;
  - morph and zoomThrough transitions; captions and lower thirds; variants and cutdowns;
  - uploaded music with beat sync; human VO upload; whisper QA;
  - four more presets; flow capture.
- **Acceptance:**
  - `examples/luraplus/spec.json` rebuilds the LuraPlus film in at most one day of authoring, and reviewers rate it at parity on 12 stills (the prototype's contact-sheet times).
  - The same spec yields a 30 s 9:16 cutdown with burned captions.

**M4: AI (2–3 weeks, once a provider exists).**
- Scope: Anthropic and Bedrock providers; brief → storyboard (scene catalog plus JSON Schema plus brand); VO shortening for cutdowns; AI-authored freeform scenes.
- **Acceptance:** at least 90% of 20 test briefs produce a valid, lint-clean spec within 2 repair rounds.

---

## 14. Testing and verification

- **Schema (vitest):**
  - every module's defaults and fixtures parse;
  - every template validates;
  - the JSON Schema snapshot is stable;
  - migrations round-trip.
- **Resolver (fast-check):**
  - no VO overlap;
  - scene ends land on the grid when snapping;
  - transitions stay inside neighbours;
  - durations grow monotonically with VO length;
  - `maxDuration` is respected or the resolver errors.
- **Golden frames:**
  - Rendered inside the pinned render image for each scene × aspect × fixture at cue times.
  - Compared by SSIM ≥ 0.985; `--update` refreshes the baselines.
  - Each scene has a long-text stress fixture that must give zero lint errors.
- **Determinism** (amended after M0, see `SPIKE.md`):
  - the renderer reloads the page at the start of every segment;
  - the same **segment** rendered by two workers with different prior history must produce byte-identical frame hashes;
  - frames rendered in shuffled order across scenes may differ by at most 1/255 per pixel.
- **Audio:**
  - a stable hash for a short render per preset;
  - LUFS within ±1 LU of target;
  - measured duck depth;
  - the TTS cache hits.
- **End to end:**
  - From M1: `vs render templates/feature-launch --variant main,social`, then a contact sheet (`ffmpeg … tile=5x5`) checked visually, as in the prototype.
  - From M2: Playwright on the studio covering login → template → edit text → preview seek → draft render → download.

---

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Fargate is CPU-only (SwiftShader), so blur, 3D and shadows are slow | M0 spike first; static-frame dedupe; grain and vignette in the post-pass; cap blur radius; ban `backdrop-filter`; quality tiers; segment fan-out |
| Generic output looks templated next to hand-made work | Deep investment in appTour and the UI kit; "energy" and "style" knobs; freeform plus code plugins as escape hatches |
| Layout breaks with long text or portrait aspect | `fitText`, `maxChars`, layout lint, per-aspect overrides, focus camera |
| Non-determinism | Runtime guards, frame-sequence video, determinism tests in CI |
| Security: AI content, SVG XSS, SSRF via flow capture | Localhost runtime with route blocking, SVG sanitization, egress allow-list, scoped IAM |
| TTS quality and espeak dependency | Pin espeak-ng and misaki in the image; brand dictionary; human VO override |
| Segment seams | Frame-aligned boundaries; sub-frame times from absolute `t`; transitions as their own segments; closed GOP; audio as one continuous mix |
| Scope creep from "anything" | Stated non-goals; freeform scene; plugins |
| Licensing | Commercial-safe stack (Playwright, Kokoro, misaki: Apache; librosa: ISC; pyloudnorm, faster-whisper: MIT; OFL fonts). Avoid Remotion (company licence), madmom, Essentia. ffmpeg with libx264 is GPL: fine for internal hosted use, review before distributing the image. |
