# WASM Image Editor: implementation plan

## Objective

Build a useful photo editor that runs entirely in the browser, uses Rust/WebAssembly for processing, and makes editing approachable for beginners. A user should be able to open a photo, apply an XMP preset or adjust a few controls, compare the result, and download the edited image.

**Status:** Milestones 0 and 1 complete and published. Milestone 2 now has global light/color controls, edit history, and the comparison divider; curves, HSL, and geometry remain. Milestones 3–5 remain open.

**Next action:** Add master/RGB curves, then publish an initial XMP importer and saved-preset library for the implemented controls. Finish HSL and crop/rotation afterwards, extending the XMP mapper as their renderers ship. This incremental sequence gets the user's preset workflow into testing sooner.

## Product boundaries

The first release includes JPEG/PNG/WebP import, exposure, contrast, warmth/tint, saturation/vibrance, master and RGB curves, individual color adjustments, crop/90-degree rotation, before/after comparison, undo/redo, XMP import, saved presets, and export.

Use PNG/JPEG export initially, with WebP offered when runtime capability checks succeed. Export always uses the original resolution unless the user intentionally crops. Add resizing as a later enhancement.

Defer RAW/HEIC development, arbitrary-angle straightening, layers, brushes, masks, AI tools, advanced denoising, HDR/wide-gamut editing, and precise Adobe rendering compatibility. Bloom, halation, grain, and vignette are attractive follow-ups after the first release works well.

## Experience and design

- **Empty state:** one clear photo drop zone and an “Open photo” button, with supported formats stated plainly.
- **Workspace:** a large image canvas, quiet neutral styling, restrained accent color, readable typography, and one compact controls panel. Avoid a toolbar full of unlabeled icons.
- **Primary controls:** Exposure, Contrast, Warmth, Tint, and Color intensity. Color intensity maps to saturation; explain this in a short tooltip. Show reset controls and sensible defaults.
- **Advanced controls:** expandable Curves and Color sections containing vibrance, RGB curves, and HSL bands. Do not render nonfunctional sliders for deferred features.
- **Presets:** an obvious “Import preset” action and a small saved-preset list. Dropping an XMP onto an open image applies it; importing before a photo saves it for later selection.
- **Compare:** a draggable divider centered on each new photo, showing the original on the left and edits on the right. Support touch, arrow keys, Home/End, a recenter button, and a “Show original” shortcut. Moving the divider changes only the preview presentation, never the edit recipe or export.
- **History:** visible Undo/Redo and Reset edits. One slider gesture, curve drag, crop commit, or preset application produces one history entry.
- **Export:** one primary button, followed by a small format/quality dialog. Show progress and keep failures recoverable.
- **Responsive layout:** side panel on desktop, collapsible panel beneath the canvas on narrow screens. Keep the image usable while controls are open.
- **Accessibility:** labeled controls, visible keyboard focus, keyboard-adjustable sliders, numeric entry for precision, adequate contrast, and no essential hover-only actions.
- **Plain language:** explain effects briefly, e.g. “Recover a warmer or cooler overall look.” Keep WASM, workers, and internal recipe details out of the editing workflow.

## Architecture

### Stack and repository layout

Use Preact + TypeScript + Vite, plain CSS with a small set of design tokens, and a Rust library compiled through `wasm-pack`/`wasm-bindgen`. Use Comlink for the worker boundary and a thin IndexedDB wrapper such as `idb` for storage.

Planned layout:

```text
src/
  app/                  UI shell and session state
  components/           shared accessible controls
  editor/               recipe, history, render scheduling
  worker/               WASM initialization and processing API
  presets/              XMP parser, mapping, persistence
  styles/               tokens and layout
crates/image-engine/    Rust processing library
tests/fixtures/         small generated images and synthetic XMP files
tests/e2e/              browser workflows
docs/                   processing semantics and XMP support matrix
```

### Image pipeline

1. Decode the original once using browser APIs; respect EXIF orientation. Prefer decoding in the worker with `createImageBitmap`/OffscreenCanvas where supported, with a main-thread decode fallback.
2. Normalize decoded input to sRGB and retain the immutable source. The initial release is an SDR sRGB editor.
3. Generate a preview with an initial longest-edge limit of 1600 pixels, then tune using measurements.
4. Send recipe changes to the worker rather than resending the source on every slider movement. Retain image buffers in the engine, and transfer result buffers where possible.
5. Recompute the preview from the source and recipe, never from the previous edited preview.
6. On export, apply the same engine and recipe to the full-resolution source, then encode once.

Use float intermediates for editing and quantize at the output boundary. Document the fixed operation order and color-space assumptions before adding multiple controls. Start with linear-light exposure/white-balance transforms, then deliberately specified contrast, tone curves, and color adjustments. Keep UI values separate from the engine's mathematical parameters.

A recipe includes a schema version, engine version, absolute adjustment values, and normalized crop/rotation parameters. History stores recipe snapshots, not pixel buffers. Apply imported preset fields as assignments, not cumulative deltas.

### Scheduling and memory

Maintain at most one active preview render and one pending latest recipe. Tag requests with revision IDs and discard stale results. Coalesce rapid changes; do not enqueue a full render for every pointer event. Worker messages alone cannot interrupt a synchronous WASM function, so use bounded preview jobs first and cooperative chunking if measurement shows it is necessary.

Preserve buffer ownership explicitly across JavaScript/WASM boundaries. Measure peak allocations as well as processing time. A 24 MP image requires about 96 MB per RGBA8 buffer and 384 MB per RGBA32F buffer; avoid retaining multiple full-resolution float intermediates.

Start with single-threaded WASM in a dedicated worker. Add SIMD, tiling, WASM threads, or GPU processing only after profiling identifies a need. If GPU preview is introduced later, verify parity with the export engine before shipping it.

## XMP presets and browser persistence

### Import contract

XMP import supports reusable presets and compatible global adjustments extracted from sidecars. It does not restore masks, healing, or a complete Lightroom project.

Parse XML by namespace URI, not a particular prefix. Support Camera Raw settings expressed as RDF attributes or elements and curve arrays expressed as RDF sequences. Never execute embedded content or resolve external resources; reject malformed XML and DTD declarations. Set an initial 2 MiB preset-file limit with an understandable error.

Produce a normalized recipe patch and an import report with applied fields, approximated fields, unsupported editing fields, and invalid values. Ignore descriptive metadata without turning each metadata field into a warning. Only report a setting as applied if its renderer is implemented.

Applying a preset changes only supported fields present in that file, preserves crop/rotation and other omitted fields, and is one undoable action. Reapplying the same preset must not compound its values. Show a short “Applied with some unsupported settings” notice when appropriate, with optional details.

### Initial mapping targets

All entries below are planned, not currently implemented. Maintain the final names, ranges, process-version handling, and conversion rules in `docs/xmp-support.md` during implementation.

| Adobe field family | Planned behavior |
| --- | --- |
| `Exposure2012` | Map EV to the engine exposure parameter; overall Adobe output can still differ |
| `Contrast2012` | Approximate with the editor's documented contrast model |
| `Saturation`, `Vibrance` | Map to documented color-intensity algorithms; no Adobe parity claim |
| `Temperature`, `Tint`, `IncrementalTemperature`, `IncrementalTint`, `WhiteBalance` | Handle absolute RAW and relative rendered-image forms explicitly; offer an approximate warmth/tint mapping where defined and flag ambiguous cases |
| `ToneCurvePV2012` and its Red/Green/Blue variants | Parse point arrays, validate domains/order, and use a documented curve interpolation method |
| `HueAdjustment*`, `SaturationAdjustment*`, `LuminanceAdjustment*` | Approximate Adobe's eight color bands using the editor's documented blending model |
| Camera profiles, calibration, grading, highlights/shadows, clarity/dehaze, sharpening/noise reduction, grain/vignette, masks, healing, geometry | Recognize as unsupported where possible and report; expand only as corresponding engine features ship |

Use `ProcessVersion` to recognize known semantics and flag unknown versions; do not silently interpret every legacy field as a current control. Embedded/external camera profiles and LUT dependencies remain unsupported initially. Do not fetch them from locations referenced in XMP.

XMP serialization is not required for the first release. Preserve the original imported file, and use the app's versioned JSON recipe internally.

### Storage

Store imported presets in **IndexedDB**, including a local ID, display name, original XML, content hash, import time, parser version, normalized fields, and compatibility report. Hash matching avoids duplicate imports; allow renaming and deletion. Reparse the preserved XML when parser versions change.

Use **localStorage** only for small UI preferences, such as the last expanded panel. Do not save full image buffers or uploaded photos there. The first release keeps the active photo and edit history in memory; reloading clears that session while saved presets remain.

If storage is unavailable or full, keep the preset usable for the current session and show a brief “Available for this session only” message. Browser storage can be cleared or evicted; describe saved presets as saved “in this browser,” and allow downloading the original XMP as a backup.

## Milestones and acceptance criteria

### 0. Establish the project — complete

- [x] Create `/Users/gxie/git/garyjx/wasm-image-editor` as a new local Git repository on `main`.
- [x] Save this roadmap, a README, and working instructions.
- [x] Check available development tools: Node 24.15.0, npm 11.12.1, Rust/Cargo 1.92.0 are present; `wasm-pack` is not installed.

### 1. Prove the full processing path — complete

- [x] Scaffold Vite/Preact/TypeScript and the Rust crate; install `wasm-pack` and the required WASM target through ordinary development tooling.
- [x] Pin dependencies and provide reproducible development/build commands.
- [x] Implement photo import, worker initialization, one Rust exposure operation, canvas preview, reset, and PNG export.
- [x] Keep the original buffer unchanged and use the latest-request scheduling policy.
- [x] Verify a known pixel transformation in Rust and a real browser import/edit/export flow.
- [x] Measure a preview and a full-resolution export on generated 12 MP and 24 MP inputs; record actual results and device/browser details. These synthetic fixtures are a baseline, not a representative real-photo corpus; broader measurements remain in Milestone 5.

**Exit condition:** a photo can be visibly edited and exported through real WASM processing without blocking ordinary UI interaction. No placeholder processing paths.

### 2. Establish the editing engine and recipe

- [x] Define and document the versioned global-adjustment recipe, operation order, color transforms, and parameter ranges; extend it as new controls ship.
- [x] Implement contrast, warmth/tint, and saturation/vibrance.
- [ ] Implement master/RGB curves and HSL bands.
- [ ] Implement normalized crop and 90-degree rotation with preview/export agreement.
- [x] Add recipe history, grouped slider gestures, per-control reset, and reset-all.
- [x] Add before/after comparison using matching geometry. A centered, draggable divider now reveals cached original/edited previews; future crop/rotation must transform both consistently.
- [ ] Verify identity settings, exposure math, curve endpoints, neutral color behavior, alpha handling, and operation-order fixtures.

**Exit condition:** the editing controls produce stable, reversible results, with a shared renderer for preview and export.

### 3. Make XMP presets useful early

- [ ] Add file-picker and drag/drop XMP import with deterministic photo-versus-preset routing.
- [ ] Implement the supported-field mapper and visible compatibility report.
- [ ] Create fixtures for attribute/element forms, namespace variations, RGB curve arrays, malformed input, partial presets, unsupported profiles/masks, and unknown process versions.
- [ ] Add IndexedDB persistence, duplicate detection, naming, deletion, and original-XMP download.
- [ ] Support presets imported before a photo and session-only operation on storage failure.
- [ ] Verify preset application as one undo step and no compounding when reapplied.
- [ ] Verify saved presets survive reload and unsupported settings are never silently presented as applied.

**Exit condition:** a user can drop in an XMP, see the supported look applied, save it in this browser, and reuse it on another image after reloading.

### 4. Finish the beginner-facing workflow

- [ ] Implement the final minimal desktop/mobile layout and progressive disclosure.
- [ ] Make sliders, curves, crop controls, preset selection, and compare usable by keyboard.
- [ ] Add JPEG export with quality selection and WebP when supported; flatten transparency against a documented background for JPEG.
- [ ] Handle decoding, unsupported format, storage, worker, and export failures without losing recoverable work.
- [ ] Show progress during import/export and keep labels, states, and reset behavior consistent.
- [ ] Document that exported images are normalized to sRGB and that source EXIF/IPTC metadata is not preserved in the first release.

**Exit condition:** a beginner can complete import → preset/manual edit → compare → export without learning implementation details.

### 5. Validate and prepare the first release

- [ ] Run production build, TypeScript checks, Rust tests, focused frontend tests, and browser workflows.
- [ ] Exercise Chromium, Firefox, and WebKit automation; separately record any real Safari/iOS/Android testing and do not equate WebKit automation with device validation.
- [ ] Profile large photos and long slider drags; add memory limits or tiled processing if measurements require them.
- [ ] Verify orientation, transparent PNGs, portrait/landscape crops, reload persistence, and preview/export color agreement.
- [ ] Check focus order, keyboard interaction, touch layout, and readable compatibility notices.
- [ ] Write setup instructions, supported formats, XMP compatibility details, and measured performance limits.

**Exit condition:** the core workflow passes its checks, known limitations are documented, and the production build can be served as static files.

## Performance targets and verification

These are initial targets, not established guarantees:

- On a recorded desktop baseline, target a p95 preview render below 100 ms for a 1600-pixel-long-edge image after WASM initialization. Record end-to-end interaction delay separately.
- Keep continuous slider interaction responsive by skipping obsolete intermediate states.
- Export the tested 24 MP images without a tab crash on the baseline desktop. Determine a lower practical limit for mobile from actual tests.
- Compare preview and export at matching sample locations/tolerances. Use the same-resolution path for strict pixel checks because downsampling changes results.
- Use small analytic fixtures for mathematical correctness and a few representative images for visual assessment. Use generated or clearly licensed fixtures, not private photos.

Run the checks appropriate to each milestone and record results. Do not broaden the test suite merely to mirror UI markup or implementation structure.

## Decisions and change log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-09-30 | Preact/TypeScript UI with a Rust/WASM worker engine | Small UI footprint and a direct, testable processing boundary |
| 2026-09-30 | Separate preview rendering from export encoding | Interactive editing must avoid full codec round-trips during slider movement |
| 2026-09-30 | IndexedDB for saved XMP files; localStorage for preferences | Presets need structured, asynchronous storage with graceful failure handling |
| 2026-09-30 | Own versioned recipe plus explicit partial XMP mapping | Adobe parameter names do not reproduce its proprietary rendering pipeline |
| 2026-09-30 | Browser codecs, SDR sRGB, single-threaded WASM first | Establish a working, measurable baseline before more complex rendering paths |
| 2026-09-30 | XMP import before final interface polish | Preset reuse is a central user requirement and should be validated early |
| 2026-09-30 | Use a float-computed 256-entry lookup table for the initial exposure operation | Equivalent to per-pixel float math for 8-bit input, without full-image float buffers; revisit when composing controls |
| 2026-09-30 | Use Rust release optimization without the optional `wasm-opt` step | Binaryen download failed; the 25.9 kB engine builds and meets the initial measured preview target with the existing compiler |
| 2026-09-30 | Record the first browser baseline in WebKit | WebKit runs normally here; Chromium and Firefox launch failures prevent claiming their coverage |
| 2026-09-30 | Publish the current milestone through GitHub Pages and license the project under MIT | User requested a shareable test site; deployment runs after successful build/unit checks on pushes to `main` |
| 2026-09-30 | Prioritize the before/after divider, then resume color/history work | User explicitly requested this interaction and asked for a commit/push after each working addition |

## Implementation log

- **2026-09-30 — Dark mode:** added a sun/moon toggle, first-paint system-preference detection, localStorage persistence with a session fallback, and a dark palette for the workspace and controls. Verified both storage cases, unchanged image pixels, persistence after reload, and the 320 px header layout; inspected desktop/mobile screenshots. The corrected color-engine deployment (`3011f82`) succeeded. Curve editing remains in progress.

- **2026-09-30 — Global color and history:** implemented engine 0.2.0 with contrast, normalized relative warmth/tint, saturation, and vibrance. Float tables compose point transforms before final quantization. Added six labeled controls, progressive disclosure for vibrance, bounded snapshot history, grouped slider gestures, per-control/global reset, and keyboard undo/redo. Eight Rust tests, four frontend tests, the production build, and nine functional WebKit workflows passed. The previous comparison deployment (`d271b24`) was verified on the live site.

- **2026-09-30 — Before/after divider:** added a split preview starting at 50%, original left / edited right, with pointer capture, touch support, keyboard arrows/Home/End, recentering, and original-view shortcut. Comparison reuses cached previews, preserves the divider while editing, resets on a new photo, and leaves exports unchanged. Production build and seven functional WebKit checks passed under the Pages project path, including rendered-pixel checks at the midpoint and both endpoints.

- **2026-09-30 — Planning:** created the local repository, checked the available toolchain, and recorded product scope, architecture, milestone gates, and XMP behavior. No application code or runtime tests yet.
- **2026-09-30 — Milestone 1:** built the Preact interface, Rust/WASM worker, immutable image storage, latest-request scheduler, exposure, comparison/reset, PNG export, local-only drag/drop, and JPEG orientation handling. Added a responsive neutral interface with a working exposure control and no placeholder advanced controls.
- **Verification:** production build/typecheck passed; 4 Rust tests and 2 scheduler tests passed. Six WebKit workflows passed across the main run and the added JPEG-orientation/drop test. Browser tests exposed a canvas-update timing issue; switching the canvas draw to a layout effect fixed it. Inspected empty and loaded layouts at 1440 px and 390 px widths.
- **Measured baseline:** Apple M4 Max, 64 GiB RAM, macOS 15.8.1, Playwright WebKit 26.6. Generated 12/24 MP images had 2–4 ms preview engine times and roughly 199/399 ms full-size PNG exports. See `docs/performance.md` for raw measurements, memory accounting, and limits.
- **Environment limitation:** Chromium launch was denied a required macOS Mach-port operation; Firefox also failed to launch. No launch restrictions were changed. Their browser checks remain pending, and real-device testing has not been performed.
- **Publishing preparation:** added MIT licensing, pinned Node/Rust toolchains, an Actions Pages workflow, project-path support, and deployment instructions. Repository: `GaryJX/wasm-image-editor`; site: `https://garyjx.github.io/wasm-image-editor/`.
- **Deployment portability fix:** the initial lockfile inherited the development environment's internal npm mirror. Replaced only public-package download URLs with canonical npm registry URLs, preserving every version and integrity hash. Canceled the first deployment, which was waiting on dependency installation, and pushed the correction.
- **Published and verified:** GitHub Actions run [36815763041](https://github.com/GaryJX/wasm-image-editor/actions/runs/36815763041) built and deployed commit `5283798` successfully. Verified the live site in WebKit: correct project-relative navigation, no failed assets or page errors, local photo import, the expected +1 EV pixel transform, and PNG download. The five functional WebKit workflows also passed against a local production build under `/wasm-image-editor/`. Future pushes to `main` deploy automatically.

## Reference implementation

Squoosh source reviewed at commit `e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3`:

- [Feature boundaries](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/src/features/README.md)
- [Worker bridge](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/src/client/lazy-app/worker-bridge/index.ts)
- [Rust resize implementation](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/codecs/resize/src/lib.rs)
- [Processing and caching controller](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/src/client/lazy-app/Compress/index.tsx)

Use these as architecture references. If source is reused, retain required license notices and review the relevant component's license.
