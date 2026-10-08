---
name: make-video
description: Turn an idea into a finished motion-graphics video (product promo, feature launch, announcement, explainer, social cutdown) with the video-studio MCP tools. Use when the user wants to make, edit or render a video.
---

# Make a video from an idea

You have the `video-studio` MCP tools. The user describes an idea; you produce the video. Do the work yourself and only ask questions that change the result: audience, call to action, length, formats, branding (their logo and colours, or a theme), and product screenshots if they have them.

## Steps

1. **Plan.** `list_templates` (templates, themes, fonts, voices), then `list_scenes`.
   - Decide whether a template fits. If none clearly does (a café, a shop, an event, anything not software), make an **original**: pick a concept, a visual world (motifs and illustrations that belong to the subject), a story arc and a palette, then design the scenes yourself with the `compose` scene.
   - Draft a storyboard: 5–8 scenes for about 30–45 s.
   - Write the voice-over at about 2.3 words per second; around 70% of the runtime should be speech.
   - Order the voice-over clauses to match what appears on screen.
   - The text must tell the story with the sound off.
2. **Create.** `create_project` with the `idea`, `brandName`, `website`, `formats`, `voice`, `length`, and either a `theme` or the user's own `colors` (+ `fonts`); add `template` only if one fits. Every project owns its brand: if the user has a logo file, `set_logo`; change looks later with `set_brand`. Then:
   - Rewrite the spec it returns to match your storyboard (keep a template's structure; replace a rule-based draft completely).
   - Use `get_scene_schema` for fields and length limits.
   - Save with `update_spec` and fix any issues it returns.
3. **Timing.** `check_timing`. Fix every lint issue: shorten text, or split a scene.
4. **Look.** `render_stills`, then study the contact sheet image. Fix:
   - wrapped or orphaned headline words;
   - empty or lopsided areas;
   - overlaps;
   - text near the edges;
   - visuals out of order with the voice-over.

   Repeat until it looks premium.
5. **Render.**
   - `render_video` with `quality: "draft"` for a quick review. Poll `render_status` every ~30 s.
   - Then render `standard` (the final) with `deliverables: "all"`.
6. **Report.** Give the user the video file paths and the web studio link (`studioUrl`), where they can make edits themselves.

## Original designs: the `compose` scene

- Layers on a % grid of the safe frame (`x`, `y` = anchor position, `w`, `h` = size), drawn back to front: `text` (display, headline, title, body, label, quote, stat), `shape`, `svg` (your own line art or flat illustration; `stroke="currentColor"` + `enter: "draw"`), `image`, `logo`, `icon`, `particles` (steam, bubbles, sparkles, confetti, dust, snow, embers, petals), `counter`, `arrow` (connectors, cause → effect), `chart` (columns, bars, line, area, donut, progress) and `list` (items appear one by one or at their own VO cue).
- `focus` camera moves fly to a point of the frame at a cue: lay a diagram out once and tour it as the voice-over explains each part.
- `list_templates` returns `videoTypes` (explainer, what's new, what if, how-to, story, comparison, top list, data story…): use the matching story shape and visual devices.
- Each layer enters at a cue (`at`: `start`, a VO line id such as `v2`, or `end`, plus `delay`) with an entrance preset; `until` makes it leave at a later cue; `loop` adds idle motion.
- Give layers a `portrait` placement for 9:16/4:5. Default text colours follow the background's lightness; still set `tone` to match it.
- Give every scene its own visual device (diagram tour, split, chart, giant number, checklist…); never the same one twice in a row, and at most one "centred headline + icon" scene per video. Use the fixed scenes where they are the best fit (screenshots → `featureSpotlight`/`screenFlow`).

## Writing rules

- **Scene length.** Scenes have no durations; they last as long as their voice-over. Don't add timestamps.
- **Headlines.** 3–8 words, with the payoff in `*asterisks*` for the accent colour. Respect the `maxChars` limits.
- **House pattern (templates and software promos).** `dark` for the problem, brand moments and the CTA; `light` for the product. `flash` into the logo reveal, `iris` into the first light scene and into the CTA, `crossfade` or `push` between product scenes. End on `ctaEndCard` (it holds at least 5 s). Original designs may choose their own tones, transitions and close.
- **Steps.** In `featureGrid` and `screenFlow`, give a voice-over line `"step": n` so the item lands as it is spoken.
- **Product screenshots.** If the user gives screenshots, `add_asset` them and use `featureSpotlight` (`visual.kind: "image"`) or `screenFlow`. Click points and focus rects are normalized 0–1 on the screenshot.
- **Formats.** Add a 9:16 `social` variant with `safeArea: "reels"`, `loudness: -14` and a shorter scene list for social cutdowns.
- **Pronunciation.** Write "AI", not "A.I.". Brand names are pronounced from the brand kit's dictionary.
