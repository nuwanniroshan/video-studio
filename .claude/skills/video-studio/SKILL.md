---
name: video-studio
description: Make motion-graphics videos (product promos, feature launches, explainers, social cutdowns) from a declarative storyboard spec with the `vs` CLI in this repo. Use when the user asks to create, edit, preview or render a video, write a storyboard, add a scene, change voice-over, fix pronunciation, or produce video deliverables.
---

# video-studio

A storyboard spec (JSON) goes in; a finished video with voice-over, score and sound design comes out. Everything runs locally and needs no LLM. You (Claude) are the author: turn the brief into a spec, check the frames with your own eyes, iterate, then render.

The CLI runs from the repo root as `pnpm vs …` (or `node apps/cli/bin/vs.mjs …`).

## Workflow (always in this order)

1. **Brief → spec.** Start from a template: `pnpm vs init <dir> --template feature-launch --brand luraplus`. A `brand/` folder next to `spec.json` (brand.json, fonts/, assets/) overrides `brands/<id>`; that is how studio projects own their brand. Edit `<dir>/spec.json`. The JSON Schema is `docs/schema.json`, and `pnpm vs scenes --json` lists every scene with its props schema and an example.
2. **Validate and resolve timing:** `pnpm vs validate <spec> --resolve`. This synthesizes VO (cached) and prints each scene's start and end plus VO placement for every variant. Fix every issue it reports; issues come with JSON paths.
3. **Look at the frames before rendering:** `pnpm vs stills <spec>` writes stills at each scene's cues plus a contact sheet per variant (`out/stills/<variant>-sheet.jpg`). **Open the sheet with the Read tool and inspect it.** Look for:
   - wrapped or orphaned headline words;
   - empty or unbalanced areas;
   - text near edges;
   - overlapping elements;
   - the wrong order of visual beats against the VO.

   For specific moments use `--at 3.2,12.5`.
4. **Lint:** `pnpm vs lint <spec>` must report 0 issues in every variant (exit code 2 means there are warnings). Lint covers:
   - text overflow and truncation;
   - text outside the safe area;
   - `maxChars` violations;
   - missing assets (an error, which blocks rendering);
   - render-cost warnings (sustained blur, too many heavy shadows).
5. **Render:** `pnpm vs render <spec> [-v main,social] [-q draft|standard|cinema] [-d none|all|master,web,hero,landing,captions,stills,stems]`.
   - Use `-q draft` to share a quick preview.
   - Use `standard` for finals and `cinema` (60 fps, 3 sub-frames) for flagship pieces.
   - Re-renders reuse cached segments, so only scenes you changed render again.
6. **QA the result:**
   - `pnpm vs sheet <video.mp4>` makes a 5×5 contact sheet of the rendered video; look at it.
   - Check `out/<variant>/audio-report.json`: LUFS should be within ±1 of the target, true peak ≤ −1 dBTP, and the duck depth about 6 dB.
   - `pnpm vs qa <spec>` runs Whisper on every VO line. Brand dictionary terms are excluded from scoring because Whisper mishears invented names; ask a human to listen to those lines.

`pnpm vs dev <spec>` opens a local player with a scrubber at http://127.0.0.1:5180. It re-reads the spec on every reload.

## Spec essentials

```jsonc
{
  "version": 1, "title": "Payroll launch", "brand": "luraplus",
  "fps": 60, "quality": "standard",
  "music": { "mode": "preset", "preset": "uplifting-tech", "bpm": 96 },   // or calm-explainer; { "mode": "none" }
  "voice": { "provider": "kokoro", "voice": "af_heart", "speed": 0.94 },
  "timing": { "snap": "bar", "leadIn": 0.45, "lineGap": 0.35, "tail": 0.6 },
  "variants": [
    { "id": "main", "aspect": "16:9" },
    { "id": "social", "aspect": "9:16", "scenes": ["hook", "flow", "cta"], "maxDuration": 30, "safeArea": "reels", "loudness": -14,
      "overrides": { "flow": { "vo": [{ "text": "Shorter line for social." }] } } }
  ],
  "scenes": [
    { "id": "hook", "type": "kineticTitle", "tone": "dark", "musicCue": "tension",
      "transitionIn": { "type": "crossfade" },
      "vo": [{ "text": "Payroll day shouldn't take all week." }],
      "props": { "kicker": "Payroll", "headline": "Payroll day shouldn't take *all week.*" } }
  ]
}
```

**Durations.** You never write durations or timestamps. A scene lasts as long as its VO needs (leadIn + lines + gaps + tail) or its own minimum, and its end snaps up to the music bar. Use `"duration": { "mode": "fixed", "seconds": 6 }` only when you must.

**Accent text.** Wrap words in `*asterisks*` for the two-tone accent: blue on light scenes, muted white on dark.

**Assets.** Paths are relative to the spec file, for example `assets/screen-1.png`; they are content-addressed automatically.

**Tones.** `dark` suits the problem, brand moments and the CTA; `light` suits the product; `brand` is a primary-colour gradient.

**Music cues** shape the score: `tension`, `build`, `reveal`, `groove`, `breath` and `resolve`. Risers and impacts land on `flash`/`iris` transitions, and the final hit lands on the CTA click.

**Transitions:** `cut`, `crossfade`, `push` (with `direction`), `iris` and `flash`. The duration is clamped to 40% of the shorter neighbouring scene.

**Variants:**
- Variants change aspect, scene list, VO and props per scene, and the loudness target.
- If a variant exceeds `maxDuration`, scenes marked `"optional": true` are dropped first; if it still doesn't fit, the resolver errors.
- `aspectOverrides` on a scene changes props for one aspect only.

## Scene catalog

| type | Use for | Key props | Steps |
|---|---|---|---|
| `kineticTitle` | Hooks, act titles | `kicker`, `headline` (≤70), `sub` (≤120); `style` is rise, mask, typewriter or scale; `align` | — |
| `logoReveal` | Brand moment (pair with a `flash` in) | `tagline` (≤60), plus `sheen`, `flare` and `glow` toggles; the logo comes from the brand kit | — |
| `featureSpotlight` | One feature: copy plus visual | `headline` (≤60), `body` (≤160), `bullets` (≤4); `visual` is either `{kind:"image", asset, frame}` or `{kind:"panel", title, rows[], action}`; `layout` (auto = split in landscape, stacked in portrait) | — |
| `featureGrid` | 2–6 benefits | `items[]` of `{icon, title ≤28, text ≤80}` | one per item |
| `screenFlow` | How-tos from screenshots | `steps[]` of `{screen, click {x,y}, type, caption, focus {x,y,w,h}}`, all normalized 0–1 | one per screenshot |
| `statsCounter` | Proof numbers | `stats[]` (1–4) of `{value, decimals, prefix, suffix, label}` | — |
| `mediaBroll` | User photos | `media`; `motion` is in, out, left, right or none; `tint`; `headline`; `position` | — |
| `ctaEndCard` | The close (holds ≥ 5 s) | `headline`, `button`, `url` (defaults to the brand), `note`; `click` makes the cursor click the button, landing the final musical hit | — |

**Icons:** home, brief, users, cal, clock, target, chart, gear, search, bell, check, lock, unlock, spark, file, shield, arrow, key, list, wallet, box, flag, cycle, msg, policy, copy.

**Steps.** Give a VO line `"step": n` to bind it to item or screenshot `n`. That step then lasts as long as its line, and the visual lands as the voice says it. Unbound lines spread the steps across the narration.

## Brand dictionary (pronunciation)

`brands/<id>/brand.json` → `pronunciations`:

```json
{ "Lura": { "ipa": "lˈuːɹə" }, "LuraPlus": { "ipa": "lˈuːɹə plˈʌs" }, "SaaS": { "respell": "sass" } }
```

- Terms match whole words, case-sensitively, and the longest match wins.
- Captions keep the original spelling.
- Write "AI", not "A.I." (the latter produces an audible pause).
- To hear what espeak would say, listen to the line in `pnpm vs dev`. Add a dictionary entry rather than misspelling the script.

## House style (what made the LuraPlus film look premium)

- **Order:** the problem on dark, the product on light, brand moments on dark. End on a held CTA card of at least 5 s, which also serves posters and loops.
- **Muted viewing:** text must carry the story with the sound off, because feeds autoplay muted. Keep headlines to about 3–8 words with a two-tone payoff.
- **VO and visuals:** order VO clauses to match the visual order (e.g. "weighted goals, blind reviews, calibration" because that's the order on screen). About 2.2–2.6 words per second at speed 0.94; around 70% VO density feels unhurried.
- **One idea per scene.** Prefer `featureSpotlight` with a real screenshot over generic panels when you have product images.
- **Original designs.** When no template fits the subject, build scenes with `compose` (free layers with cue-timed entrances and your own SVG illustrations; `pnpm vs scenes --json` has its schema). The order rules above are the house pattern for software promos, not a requirement.
- **Portrait (9:16):** use `safeArea: "reels"` so text avoids the platform UI. screenFlow zooms to each step's `focus` rect.

## Troubleshooting

| Lint code | Fix |
|---|---|
| `text-overflow` / `text-truncated` | Shorten the text or remove a bullet. Headlines shrink to fit, but body text doesn't. |
| `outside-safe-area` | Shorten the text, or for portrait add an `aspectOverrides` entry with shorter copy. |
| `max-chars` | The UI limit was exceeded; shorten. |
| `missing-asset` | Check the path relative to the spec. |
| `sustained-blur` / `heavy-shadows` | Render-cost warnings (CPU rendering on Fargate). Avoid in custom scenes. |
| `TimingError … maxDuration` | Shorten the variant's VO with `overrides`, mark scenes `optional`, or raise `maxDuration`. |

Outputs go to `<spec dir>/out/<variant>/`:
- `<title>_<variant>.mp4`: the fast review master;
- `*_master.mp4`, `*_web.mp4`, hero and landing encodes with a vignette, from `-d all` (add `--grain` for film grain, which makes masters much larger);
- `*.srt` / `*.vtt` captions;
- stems and `mix.wav`;
- `*.timeline.json` (the resolved timeline).
