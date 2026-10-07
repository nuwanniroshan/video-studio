# video-studio

A code-driven motion-graphics video generator. A declarative storyboard spec goes in; a finished video with voice-over, score and sound design comes out.

- **Planning:** [`docs/PLAN.md`](docs/PLAN.md).
- **Prototype lessons:** [`docs/REFERENCE.md`](docs/REFERENCE.md).
- **Render benchmarks:** [`docs/SPIKE.md`](docs/SPIKE.md).
- **M1 results:** [`docs/M1.md`](docs/M1.md).
- **Authoring with Claude Code:** [`.claude/skills/video-studio/SKILL.md`](.claude/skills/video-studio/SKILL.md).

## Setup (macOS)

```bash
brew install espeak-ng ffmpeg
pnpm install
pnpm --filter @vs/render exec playwright install chromium
scripts/setup-python.sh          # .venv + Kokoro models (~350 MB) into models/
pnpm build                       # runtime bundle
```

## Make a video

```bash
pnpm vs init my-launch --template feature-launch --brand luraplus
pnpm vs validate my-launch/spec.json --resolve
pnpm vs stills my-launch/spec.json        # contact sheets: look at them
pnpm vs lint my-launch/spec.json
pnpm vs render my-launch/spec.json -d all # out/<variant>/…
pnpm vs dev my-launch/spec.json           # local player with a scrubber
```

## Tests

| What | Command |
|---|---|
| Unit and property tests (TypeScript), then audio tests | `pnpm test` (runs `pnpm test:py` after turbo) |
| Audio tests only (pytest) | `pnpm test:py` |
| Golden frames and determinism, inside the pinned render image | `scripts/golden.sh` (`--update` refreshes the baselines) |
| M1 acceptance (render, re-render ratio, loudness, Whisper QA) | `scripts/acceptance-m1.sh` |

## Layout

| Path | What lives there |
|---|---|
| `packages/spec` | zod schemas, scene catalog, JSON Schema export, migrations |
| `packages/timing` | resolver: spec + VO durations + beat grid → timeline |
| `packages/engine` | seekable animation engine |
| `packages/scenes` | scenes |
| `packages/runtime` | player bundle served over `http://127.0.0.1` |
| `packages/render` | asset store, analyze pass, segment cache and renderer, deliverables |
| `packages/brand` | brand kit → CSS custom properties and fonts |
| `packages/storage` | local content addressing |
| `python/vsaudio` | text-to-speech (Kokoro) with a pronunciation dictionary, score presets, automix and loudness, Whisper QA |
| `apps/cli` | the `vs` CLI |
| `templates/`, `brands/` | starting points and brand kits |
| `tests/` | golden frames and determinism |
| `docker/Dockerfile.render` | the render image |
