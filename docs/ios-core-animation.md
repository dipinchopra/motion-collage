# iOS animation mapping

The web prototype keeps all nine treatments to layer transforms and opacity. Its motion equations live in `src/tool-layout.js`; no animated blur, shader, or particle effect is required. The RMBG-1.4 model, q8 weights, masks, and background-removal behavior are unchanged by this layout update.

| Tool | Native representation | Tunings |
| --- | --- | --- |
| Motion | Centered image/text layers under a `CATransformLayer`; animate Y rotation with `CABasicAnimation`, preserving individual angle offsets and perspective. | Whole turns per 10 seconds, angle spacing, scale, direction |
| Orbit | Animate position, Z translation, Y/Z rotation from the periodic transform values with `CAKeyframeAnimation`. Use a 3D-preserving container for depth ordering. | Radius, tilt, whole turns per 10 seconds |
| Echo | Separate layers sharing the same `CGImage`, following the same periodic motion at staggered phases. Each has fixed scale and opacity. This preserves the exact treatment without duplicating image data. | Copies (2–5), phase spacing, whole turns per 10 seconds |
| Shutters | Crop the shared image into horizontal `contentsRect` bands. Each band rotates around its own X axis with staggered `CAKeyframeAnimation`; perspective stays on the parent. | Bands (3–8), fold angle, tempo |
| Ribbon | Tile image/text layers in rows inside a clipped container. Translate the repeated tile group one full tile width per cycle; alternating rows run in opposite directions. | Rows (1–3), slant, speed |
| Stamp | Predetermined positions and tilts, sequential scale overshoot keyframes, then a synchronized opacity clear. Reuse the same contents for each impression. | Stamps (1–4 per asset), impact, tempo |

## Subject-as-material tools

- **Brush:** normalize finger strokes into portrait coordinates and resample by distance. Each stamp is a layer sharing the original cutout image, with a position and tangent rotation. Preserve the asset/layer per stroke so changing brushes keeps prior marks. Replay uses staggered opacity keyframes; clear and undo update the recorded stroke list. Stamp counts are bounded (64 mobile / 96 desktop), with no per-frame image processing.
- **Bend:** share one cutout bitmap across foot-anchored layers. Animate position and Y/Z rotations with staggered phases; touch input adjusts bend and depth. These are `CALayer` transforms under a perspective-preserving parent.
- **Cutline:** pre-render a colored alpha dilation behind the subject into one bitmap, cached per source/color/edge width. Use this bitmap for the same recorded-stroke layer structure; the dense stack has a small periodic wave. The border is generated only when the source/style changes, never once per video frame.

Brush and Cutline initially show editable sample paths; the first stroke replaces the sample. Clear produces an empty canvas, and Undo removes one user stroke. The supplied recordings/GIF are reference material only and are not packaged or published with the app. Background removal and its model remain unchanged.

## Porting rules

- Use a single clock for photos, text, cutouts, inverse image layers, preview, and export.
- A full loop is 10 seconds. For the first six tools sample `toolTransform`; the subject tools use `resampleStrokes`, `paintPose`, and `bendPose`. Use phase `t × 2π × cycles × direction` for normalized `t` from 0 through 1. Include both endpoints in the native keyframes; video frames exclude the duplicate endpoint.
- Core Animation's view-space Y direction is opposite the prototype's world-space Y. Negate Y when mapping positions; match camera perspective using `sublayerTransform.m34` and the container's dimensions.
- Keep text and inverse image layers as shared raster layer contents to match the prototype. Mask edges retain their alpha.
- The shared-axis treatment animates one parent rotation; child wing angles stay fixed. Full image planes are evenly spaced over 180° by default (two planes form four wings at 90°). Changing the angle control opts into manual spacing. Keep depth occlusion for opaque cutout pixels, and discard transparent mask pixels before depth writes.
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

## Stickers and emoji

The sticker library uses the supplied transparent PNGs. Emoji are rasterized once with the platform color emoji font. Both become ordinary image layers and are included by the existing preview/video pipeline. No segmentation runs for stickers.

In Motion, a sticker inherits the selected image/text wing's angle; it does not add a new wing or change spacing. Native equivalents are child `CALayer` objects with shared `CGImage` contents and local position/rotation/scale. Detach or reassign the host when deleting its image.

Bundled background/sticker filenames are whitespace-free: the URL constructor trims leading whitespace from relative URL strings, so a leading space in an emitted asset filename produces a nonexistent request path.
