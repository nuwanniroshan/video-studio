# AGENTS.md

## video-studio

A generic, code-driven motion-graphics video generator: a declarative storyboard goes in, finished videos (with voiceover, score and sound design) come out. It serves non-technical users through a web studio and technical users through the `vs` CLI and a Claude Code skill.

**Status:** planning complete, implementation not started.

## Read first

1. [`docs/PLAN.md`](docs/PLAN.md) is the approved architecture, spec schema, scene library, pipeline, UI, infrastructure, milestones (M0–M4) and acceptance criteria.
2. [`docs/REFERENCE.md`](docs/REFERENCE.md) has the exact parameters, measured numbers, pitfalls and commands from the working prototype. **Check it before solving anything the prototype already solved.**

## Prototype (read-only reference)

`/Users/swiveltech/Disk/Swivel/acentra-platform/marketing/promo-video` produced the LuraPlus launch film.

- **Copy** files into this repo and refactor them here. **Never edit the prototype in place.**
- That folder belongs to the Lura+ workspace.
- [`docs/PLAN.md` §4](docs/PLAN.md) maps each prototype file to its destination.

## Working rules

- Build milestones in order: **M0 spike → M1 → M2 → M3 → M4**. Each must meet its acceptance criteria before the next starts. Demo M1 before M2.
- Scenes animate against resolver **cues**, never absolute seconds or hard-coded pixel positions.
- Never load the runtime over `file://`. Serve it from `http://127.0.0.1` with all other origins blocked (`page.route`).
- Keep the stack commercial-safe (see REFERENCE §9): no Remotion, madmom or Essentia.
- **Visual QA is mandatory:**
  - Render stills at cue times and inspect contact sheets before any full render.
  - Run golden-frame tests in the pinned render image.
- **Audio QA:** loudness within ±1 LU of target, duck depth checked, and Whisper QA on non-dictionary words.
- The tool must work fully without an LLM. AI (`packages/ai`) is optional and pluggable.
