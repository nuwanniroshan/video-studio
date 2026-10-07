# Template: feature launch (~45 s)

Hook → logo reveal → feature spotlight → three-click screen flow → feature grid → proof stats → CTA.
Variants: `main` (16:9) and `social` (9:16, ≤ 35 s, Reels safe area, −14 LUFS).

- `assets/flow-*.png` are screenshots of a mock app (`_source/mock.html`); replace them with your product.
  Click points are normalized (0..1) positions on the screenshot; `focus` is the rect portrait variants zoom to.
- `assets/broll.jpg` is a placeholder for `mediaBroll` scenes.
- Regenerate the sample assets: `node templates/feature-launch/_source/make-assets.mjs`.

```bash
vs init my-launch --template feature-launch --brand luraplus
vs validate my-launch/spec.json --resolve
vs stills my-launch/spec.json            # contact sheet at scene cues: look at it
vs render my-launch/spec.json -q standard
```
