# Processing contract: engine 0.1.0

## Input and output

The first engine accepts decoded 8-bit sRGB RGBA images. JPEG/PNG/WebP decoding uses browser APIs and honors EXIF orientation. A worker-side canvas requests sRGB pixel data; browsers without the required worker APIs fall back to a main-thread canvas. Color-profile behavior relies on the browser decoder and needs a wider fixture set before claiming broad profile compatibility.

The source and a preview with a maximum edge of 1600 pixels are retained as immutable byte buffers in WASM. PNG export processes the full-size source. The browser encodes it in the worker when supported, with a main-thread encoding fallback. Export does not retain source EXIF/IPTC metadata.

Current import limits are 60 MiB compressed, 40 megapixels decoded, and 16,384 pixels per side. The decoded-size check runs after browser decoding, so it does not guarantee avoiding every large-image allocation. Only generated inputs up to 24 MP have been measured so far; mobile memory limits need device testing.

## Recipe

```json
{
  "schemaVersion": 1,
  "engineVersion": "0.1.0",
  "exposure": 0
}
```

Exposure is an absolute EV value in [-4, +4]. A +1 EV setting multiplies linear-light RGB by two. The source remains unchanged, and each render recomputes from it. Comparison clips a cached zero-exposure preview over the edited preview, with the original on the left. Moving the divider does not invoke the engine. Exporting still uses the current edit even while the original is displayed.

For each color channel:

1. Convert the sRGB input to linear light using the standard piecewise sRGB transfer function.
2. Multiply by `2^exposure`.
3. Clamp to [0, 1], convert back to sRGB, and round to the nearest 8-bit value.
4. Copy alpha unchanged.

The current single operation uses a 256-entry table computed in float precision. This is equivalent to evaluating that transform for each possible input byte and avoids expensive per-pixel powers. Future operations must compose with float intermediates before the final quantization; they should not chain independently quantized 8-bit passes.

Example: `[128, 64, 0, 127]` at +1 EV becomes `[176, 90, 0, 127]`. Identity exposure preserves all byte values exactly inside the Rust engine. Browser canvas round-trips can still quantize partially transparent RGB values because of premultiplication.

## Work scheduling and memory

`LatestRenderer` permits one running preview and one pending latest recipe. New requests replace the pending recipe and make older results obsolete. Opening another image invalidates outstanding preview results. A failed replacement import resumes the prior recipe on the prior source.

The worker passes recipe values to Rust and transfers output buffers back to the UI. Rust-owned output is copied to JavaScript by `wasm-bindgen`, then its Rust allocation is released. Full-resolution float buffers are not allocated. WASM linear memory can grow and retain its capacity even when individual buffers are freed.

The canvas is updated in a layout effect so the visible pixels agree with the committed render state before the next paint.

## Deliberate limits

This engine does not yet implement XMP import, other adjustments, crop, history, saved sessions, wide-gamut/HDR output, or RAW development. No hidden alternative renderer or server-side image processing is used.
