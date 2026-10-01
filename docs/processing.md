# Processing contract: engine 0.7.0

## Input and output

The first engine accepts decoded 8-bit sRGB RGBA images. JPEG/PNG/WebP decoding uses browser APIs and honors EXIF orientation. A worker-side canvas requests sRGB pixel data; browsers without the required worker APIs fall back to a main-thread canvas. Color-profile behavior relies on the browser decoder and needs a wider fixture set before claiming broad profile compatibility.

The source and a preview with a maximum edge of 1600 pixels are retained as immutable byte buffers in WASM. Image export processes the full-size source. The browser encodes PNG, JPEG, or WebP in the worker when supported, with a main-thread encoding fallback. Export formats are feature-tested and the actual output MIME type is checked, so unsupported codecs cannot silently create mislabeled files. JPEG flattens transparency onto the selected white or black background; PNG/WebP retain alpha. Export does not retain source EXIF/IPTC metadata.

Current import limits are 60 MiB compressed, 40 megapixels decoded, and 16,384 pixels per side. The decoded-size check runs after browser decoding, so it does not guarantee avoiding every large-image allocation. Only generated inputs up to 24 MP have been measured so far; mobile memory limits need device testing.

## Recipe

```json
{
  "schemaVersion": 1,
  "engineVersion": "0.7.0",
  "exposure": 0,
  "contrast": 0,
  "warmth": 0,
  "tint": 0,
  "saturation": 0,
  "vibrance": 0,
  "highlights": 0,
  "shadows": 0,
  "whites": 0,
  "blacks": 0,
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
4. Apply Shadows, Highlights, Blacks, and Whites in that order using the monotone curves below.
5. Apply the master curve, then the corresponding RGB channel curve.
6. Apply saturation/vibrance around weighted sRGB luma and clamp.
7. Apply color mix in HSL.
8. Apply the optional curve look or LUT, blend by its amount, and quantize once.
9. Copy alpha unchanged.

The first five operations are composed into three 256-entry float tables. Saturation/vibrance then operate on float RGB values for each pixel, with one final quantization. This avoids full-resolution float buffers and repeated per-pixel powers.

Curves use 2–32 normalized input/output points, increasing input coordinates, fixed input endpoints 0 and 1, and output values in [0, 1]. Interpolation is piecewise linear. The UI displays point values on a 0–255 scale. Master and channel curves are separate and are composed in that order; matching Adobe's spline interpolation is not claimed.

All controls except exposure use [-100, 100]. With warmth `w` and tint `t` scaled to [-1, 1], white-balance gains are `[2^(0.4w + 0.2t), 2^(-0.2t), 2^(-0.4w + 0.2t)]`, normalized so their Rec.709-weighted sum is 1. These are relative color controls for rendered photos, not calibrated RAW Kelvin adjustments.

Contrast maps each encoded channel `v` to `(v - 0.5) * 2^(contrast/100) + 0.5`. Saturation/vibrance use luma weights `[0.2126, 0.7152, 0.0722]` on encoded RGB, with a chroma multiplier `(1 + saturation/100) * (1 + vibrance/100 * (1 - (maxRGB - minRGB)))`. This is the editor's documented model, not an implementation of Adobe's proprietary algorithms.

Example: `[128, 64, 0, 127]` at +1 EV becomes `[176, 90, 0, 127]`. Identity exposure preserves all byte values exactly inside the Rust engine. Browser canvas round-trips can still quantize partially transparent RGB values because of premultiplication.

Color mix adds an `hsl` recipe object with hue/saturation/luminance values for red, orange, yellow, green, aqua, blue, purple, and magenta (all default to zero). Hue centers are 0°, 30°, 60°, 120°, 180°, 240°, 270°, and 300°. Adjacent ranges blend linearly, including the red wraparound. Hue values map to ±30°, saturation multiplies by 0–2, and luminance offsets HSL lightness by up to ±0.5. Effects fade near neutral colors using `min(1, HSL saturation * 4)`; exact grays remain unchanged. Zero settings bypass HSL conversion. Adobe equivalence is approximate.

The recipe also has `look: null` by default. Supported curve looks and referenced LUTs are defined in [look-support.md](look-support.md). Rendering identity excludes look names/UUIDs and treats zero amount as inactive. LUT data is cached separately from recipe/history snapshots and restored when a worker is recovered.

## Tonal ranges

Highlights, Shadows, Whites, and Blacks each use [−100, +100], normalized below to `h`, `s`, `w`, and `b` in [−1, +1]. After exposure/white balance and contrast, apply these updates sequentially to each encoded channel value `v`:

```text
v ← clamp(v + s × v × (1 − v)³)
v ← clamp(v + h × v³ × (1 − v))
v ← clamp(v + 0.25 × b × (1 − v)⁴)
v ← clamp(v + 0.25 × w × v⁴)
```

Clamp to [0, 1]. Shadows and Highlights preserve pure black and pure white while primarily changing their respective darker/lighter ranges. Blacks and Whites act more strongly near the endpoints; positive Blacks lifts black and negative Whites lowers white. All supported extreme combinations remain monotone, preventing reversal of a grayscale ramp. These transforms are composed into the existing small per-channel tables; no additional full-size buffers or per-pixel neighborhood processing is required.

These are global, channel-wise SDR tone adjustments. They may change hue like RGB tone curves and do not reproduce Adobe's local tone mapping. They cannot recover detail already clipped in an input file or by the preceding exposure/contrast stages. Zero values preserve the previous engine's pixel results exactly.

Saved sessions from engine 0.6.0 migrate to 0.7.0 with neutral defaults for the new controls. Current, past, future, and export-baseline recipes are migrated together; unknown newer versions remain unsupported rather than being reset.

## Framing

The recipe includes `geometry: {crop: {x: 0, y: 0, width: 1, height: 1}, rotation: 0}` by default. Crop coordinates are normalized against the decoded, EXIF-oriented source, and rotation is a clockwise quarter-turn count (0–3). Crop edges are snapped to source pixels when applied. Rendering crops first, then rotates, then applies the color pipeline. Preview and export round normalized edges to their respective grids, so sub-preview-pixel edge differences are possible on large images.

The crop dialog displays the full image at the current rotation and maps its selection back to source coordinates. Cancel does not change the recipe. A crop or rotation is one undoable edit and participates in leave-page protection. XMP preset application preserves geometry.

The worker caches an unedited preview with the same geometry. Preview requests include the geometry the UI has actually displayed; a matching original is returned whenever necessary, including after superseded renders. This keeps the divider aligned without retransmitting the original for every color-only change.

## Zoom and detail

The fit preview still uses the 1600-pixel source preview. Zoom/pan is separate view state: both comparison images share the same transform, while the divider clips them in viewport coordinates. Fit is the minimum zoom; 100% means one source pixel per CSS pixel, and 400% is the maximum. A successful new photo or geometry change resets the view.

After a 100 ms pause in view changes, a separate latest-request scheduler requests the visible output rectangle from the worker. Rust maps that rectangle through the source crop/rotation and samples directly from the immutable full-resolution source, then runs the existing color pipeline. Each original/edited detail buffer is capped at 2048×2048; device-pixel-ratio sampling is capped at 2. No full-resolution intermediate image is needed for detail. At native sampling, pixels match the full export exactly. Below native sampling, alpha-weighted bilinear resampling happens before color processing and can differ from downsampling the final export, as can the ordinary fit preview.

The smaller preview remains available during motion. Detail results are shown only when their recipe and viewport rectangle match the current view. Pending detail work is invalidated during import, recovery, and editing; obsolete results are discarded. Zooming and panning never mutate the edit recipe, history, export, or unsaved-edit baseline. Comparison-only movements do not request a render.

## Work scheduling and memory

`LatestRenderer` permits one running preview and one pending latest recipe. New requests replace the pending recipe and make older results obsolete. Opening another image invalidates outstanding preview results. A failed replacement import resumes the prior recipe on the prior source.

The worker passes recipe values to Rust and transfers output buffers back to the UI. Rust-owned output is copied to JavaScript by `wasm-bindgen`, then its Rust allocation is released. Full-resolution float buffers are not allocated. WASM linear memory can grow and retain its capacity even when individual buffers are freed.

The canvas is updated in a layout effect so the visible pixels agree with the committed render state before the next paint.

## Deliberate limits

History stores up to 100 immutable recipe snapshots, groups a slider gesture into one step, and clears redo when a new edit is committed. It never stores full-image history buffers. Comparison position is independent of the recipe and history.

XMP import maps a documented subset of fields to this recipe; see [xmp-support.md](xmp-support.md). This engine does not implement wide-gamut/HDR output or RAW development. No hidden alternative renderer or server-side image processing is used.

## Saved photo sessions

The photo library saves immutable compressed source bytes, small JPEG thumbnails, validated versioned recipe/history snapshots, the comparison position, export baseline, and required LUT data in IndexedDB. Binary buffers are used for sources and thumbnails because Blob/File serialization failed in the tested local WebKit build. Original bytes are written once; subsequent saves coalesce metadata updates after 300 ms of inactivity, with one-second checkpoints during continuous edits. A save status becomes complete only after its matching transaction commits. In-flight older saves cannot mark newer edits saved, and deletion waits for earlier writes to finish.

Inactive photos retain metadata and thumbnails in memory, with originals read from storage when selected. If storage fails, the original and latest state remain available in the tab and the row offers Retry saving. Reload offers Resume photo rather than decoding a stored original before the user chooses it. Unknown or malformed saved versions are not reset silently. The selected photo retains its unexported-edit warning; unsaved inactive work is also protected. Saved inactive sessions do not require export merely to leave the page.

Sessions are local browser data, not durable backups or synchronized projects. Clearing site data removes them. Removing a session deletes its source/metadata and unused session LUT copies, without removing independently saved preset-library assets.
