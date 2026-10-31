# iOS animation mapping

The web prototype keeps all six treatments to layer transforms and opacity. Its motion equations live in `src/tool-layout.js`; no animated blur, shader, or particle effect is required. The RMBG-1.4 model, q8 weights, masks, and background-removal behavior are unchanged by this layout update.

| Tool | Native representation | Tunings |
| --- | --- | --- |
| Motion | Centered image/text layers under a `CATransformLayer`; animate Y rotation with `CABasicAnimation`, preserving individual angle offsets and perspective. | Whole turns per 10 seconds, angle spacing, scale, direction |
| Orbit | Animate position, Z translation, Y/Z rotation from the periodic transform values with `CAKeyframeAnimation`. Use a 3D-preserving container for depth ordering. | Radius, tilt, whole turns per 10 seconds |
| Echo | Separate layers sharing the same `CGImage`, following the same periodic motion at staggered phases. Each has fixed scale and opacity. This preserves the exact treatment without duplicating image data. | Copies (2–5), phase spacing, whole turns per 10 seconds |
| Shutters | Crop the shared image into horizontal `contentsRect` bands. Each band rotates around its own X axis with staggered `CAKeyframeAnimation`; perspective stays on the parent. | Bands (3–8), fold angle, tempo |
| Ribbon | Tile image/text layers in rows inside a clipped container. Translate the repeated tile group one full tile width per cycle; alternating rows run in opposite directions. | Rows (1–3), slant, speed |
| Stamp | Predetermined positions and tilts, sequential scale overshoot keyframes, then a synchronized opacity clear. Reuse the same contents for each impression. | Stamps (1–4 per asset), impact, tempo |

## Porting rules

- Use a single clock for photos, text, cutouts, inverse panels, preview, and export.
- A full loop is 10 seconds. Sample `toolTransform` at phase `t × 2π × cycles × direction` for normalized `t` from 0 through 1. Include both endpoints in the native keyframes; video frames exclude the duplicate endpoint.
- Core Animation's view-space Y direction is opposite the prototype's world-space Y. Negate Y when mapping positions; match camera perspective using `sublayerTransform.m34` and the container's dimensions.
- Keep text and inverse panels as shared raster layer contents to match the prototype. Mask edges retain their alpha.
- For the shared-axis treatment, preserve the 3D layer hierarchy; an ordinary flattened container will change intersections and depth ordering.
- Pause/resume the parent layer's clock, so every image and text layer stays synchronized.
- Speed zero deliberately freezes a composition. Other speed values are integer loops per export, so the video wraps without a jump.

## Editor layout

The web editor uses the visible viewport, including keyboard changes, to size its sheet. Tabs stay outside the sheet's vertical scroll area; cutout variants and tabs each retain horizontal scrolling. At very short heights the open editor takes priority over the preview; closing it restores the preview.

For the native implementation use a safe-area-aware sheet with a `ScrollView` for tool content and a persistent tab rail. Keep the native keyboard and home-indicator insets in the layout calculation.

## Apple references

- [CATransformLayer](https://developer.apple.com/documentation/quartzcore/catransformlayer)
- [CAKeyframeAnimation](https://developer.apple.com/documentation/quartzcore/cakeyframeanimation)
- [CAReplicatorLayer](https://developer.apple.com/documentation/quartzcore/careplicatorlayer) for treatments whose per-copy transforms are uniform
- [Sheet content scrolling](https://developer.apple.com/documentation/swiftui/view/presentationcontentinteraction(_:))
