# Processing contract: engine 0.3.0

## Input and output

The first engine accepts decoded 8-bit sRGB RGBA images. JPEG/PNG/WebP decoding uses browser APIs and honors EXIF orientation. A worker-side canvas requests sRGB pixel data; browsers without the required worker APIs fall back to a main-thread canvas. Color-profile behavior relies on the browser decoder and needs a wider fixture set before claiming broad profile compatibility.

The source and a preview with a maximum edge of 1600 pixels are retained as immutable byte buffers in WASM. PNG export processes the full-size source. The browser encodes it in the worker when supported, with a main-thread encoding fallback. Export does not retain source EXIF/IPTC metadata.

Current import limits are 60 MiB compressed, 40 megapixels decoded, and 16,384 pixels per side. The decoded-size check runs after browser decoding, so it does not guarantee avoiding every large-image allocation. Only generated inputs up to 24 MP have been measured so far; mobile memory limits need device testing.

## Recipe

```json
{
  "schemaVersion": 1,
  "engineVersion": "0.3.0",
  "exposure": 0,
  "contrast": 0,
  "warmth": 0,
  "tint": 0,
  "saturation": 0,
  "vibrance": 0,
  "curves": {
    "master": [[0, 0], [1, 1]],
    "red": [[0, 0], [1, 1]],
    "green": [[0, 0], [1, 1]],
    "blue": [[0, 0], [1, 1]]
  }
}
```

Exposure is an absolute EV value in [-4, +4]. A +1 EV setting multiplies linear-light RGB by two. The source remains unchanged, and each render recomputes from it. Comparison clips a cached zero-exposure preview over the edited preview, with the original on the left. Moving the divider does not invoke the engine. Exporting still uses the current edit even while the original is displayed.

The current operation order is:

1. Convert the sRGB input to linear light using the standard piecewise sRGB transfer function.
2. Multiply by `2^exposure` and the relative white-balance gains described below.
3. Convert back to sRGB, apply contrast around 0.5, then clamp to [0, 1].
4. Apply the master curve, then the corresponding RGB channel curve.
5. Apply saturation/vibrance around weighted sRGB luma; clamp and round to the nearest 8-bit value.
6. Copy alpha unchanged.

The first four operations are composed into three 256-entry float tables. Saturation/vibrance then operate on float RGB values for each pixel, with one final quantization. This avoids full-resolution float buffers and repeated per-pixel powers.

Curves use 2–32 normalized input/output points, increasing input coordinates, fixed input endpoints 0 and 1, and output values in [0, 1]. Interpolation is piecewise linear. The UI displays point values on a 0–255 scale. Master and channel curves are separate and are composed in that order; matching Adobe's spline interpolation is not claimed.

All controls except exposure use [-100, 100]. With warmth `w` and tint `t` scaled to [-1, 1], white-balance gains are `[2^(0.4w + 0.2t), 2^(-0.2t), 2^(-0.4w + 0.2t)]`, normalized so their Rec.709-weighted sum is 1. These are relative color controls for rendered photos, not calibrated RAW Kelvin adjustments.

Contrast maps each encoded channel `v` to `(v - 0.5) * 2^(contrast/100) + 0.5`. Saturation/vibrance use luma weights `[0.2126, 0.7152, 0.0722]` on encoded RGB, with a chroma multiplier `(1 + saturation/100) * (1 + vibrance/100 * (1 - (maxRGB - minRGB)))`. This is the editor's documented model, not an implementation of Adobe's proprietary algorithms.

Example: `[128, 64, 0, 127]` at +1 EV becomes `[176, 90, 0, 127]`. Identity exposure preserves all byte values exactly inside the Rust engine. Browser canvas round-trips can still quantize partially transparent RGB values because of premultiplication.

## Work scheduling and memory

`LatestRenderer` permits one running preview and one pending latest recipe. New requests replace the pending recipe and make older results obsolete. Opening another image invalidates outstanding preview results. A failed replacement import resumes the prior recipe on the prior source.

The worker passes recipe values to Rust and transfers output buffers back to the UI. Rust-owned output is copied to JavaScript by `wasm-bindgen`, then its Rust allocation is released. Full-resolution float buffers are not allocated. WASM linear memory can grow and retain its capacity even when individual buffers are freed.

The canvas is updated in a layout effect so the visible pixels agree with the committed render state before the next paint.

## Deliberate limits

History stores up to 100 immutable recipe snapshots, groups a slider gesture into one step, and clears redo when a new edit is committed. It never stores full-image history buffers. Comparison position is independent of the recipe and history.

This engine does not yet implement XMP import, HSL, crop, saved sessions, wide-gamut/HDR output, or RAW development. No hidden alternative renderer or server-side image processing is used.
