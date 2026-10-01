# Still Photo Editor: implementation plan

## Objective

Build a useful photo editor that runs entirely in the browser, uses Rust/WebAssembly for processing, and makes editing approachable for beginners. A user should be able to open a photo, apply an XMP preset or adjust a few controls, compare the result, and download the edited image.

**Status:** Milestones 0–9 are complete for the documented supported formats. Version 1.2.0 is deployed and live-verified at https://garyjx.github.io/still-photo-editor/. The repository/local folder rename and tagline update are complete. Unsupported Adobe camera/profile-table formats and real-device testing limits are explicitly documented.

**Next action:** Publish and live-verify Highlights/Shadows/Whites/Blacks with XMP support and saved-session migration. The confirmed focus is session recovery, the photo list, and these light controls; the other suggestions remain future ideas.

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

Current implementation and limits are recorded in `docs/xmp-support.md`. Exposure, contrast, saturation/vibrance, relative temperature/tint, master/RGB curves, and HSL are mapped. Absolute RAW white balance and the other unsupported groups below remain future work.

| Adobe field family | Planned behavior |
| --- | --- |
| `Exposure2012` | Map EV to the engine exposure parameter; overall Adobe output can still differ |
| `Contrast2012` | Approximate with the editor's documented contrast model |
| `Saturation`, `Vibrance` | Map to documented color-intensity algorithms; no Adobe parity claim |
| `Temperature`, `Tint`, `IncrementalTemperature`, `IncrementalTint`, `WhiteBalance` | Handle absolute RAW and relative rendered-image forms explicitly; offer an approximate warmth/tint mapping where defined and flag ambiguous cases |
| `ToneCurvePV2012` and its Red/Green/Blue variants | Parse point arrays, validate domains/order, and use a documented curve interpolation method |
| `HueAdjustment*`, `SaturationAdjustment*`, `LuminanceAdjustment*` | Approximate Adobe's eight color bands using the editor's documented blending model |
| Camera profiles, calibration, grading, clarity/dehaze, sharpening/noise reduction, grain/vignette, masks, healing, geometry | Recognize as unsupported where possible and report; expand only as corresponding engine features ship |

Use `ProcessVersion` to recognize known semantics and flag unknown versions; do not silently interpret every legacy field as a current control. Embedded/external camera profiles and LUT dependencies remain unsupported initially. Do not fetch them from locations referenced in XMP.

XMP serialization is deferred to Milestone 6, after the current roadmap (Milestones 2–5), at the user's request. Preserve the original imported file, and use the app's versioned JSON recipe internally so both import and later export can share explicit field mappings.

### Storage

Store imported presets in **IndexedDB**, including a local ID, display name, original XML, content hash, import time, parser version, normalized fields, and compatibility report. Hash matching avoids duplicate imports; allow renaming and deletion. Reparse the preserved XML when parser versions change.

Use **localStorage** only for small UI preferences, such as the last expanded panel. Do not save full image buffers or uploaded photos there. Photo sessions use a separate IndexedDB database for original compressed bytes, thumbnails, recipe/history snapshots, and LUT dependencies. On return, Resume photo or the Photos list reopens a saved session. Storage failures retain the latest work in the current tab with a session-only status.

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
- [x] Implement master/RGB curves.
- [x] Implement HSL bands and corresponding XMP mappings.
- [x] Implement normalized crop and 90-degree rotation with preview/export agreement.
- [x] Add recipe history, grouped slider gestures, per-control reset, and reset-all.
- [x] Add before/after comparison using matching geometry. A centered, draggable divider now reveals cached original/edited previews; future crop/rotation must transform both consistently.
- [x] Verify identity settings, exposure math, curve endpoints, neutral color behavior, alpha handling, operation order, and geometric pixel mapping.

**Exit condition:** the editing controls produce stable, reversible results, with a shared renderer for preview and export.

### 3. Make XMP presets useful early

- [x] Add file-picker and drag/drop XMP import with deterministic photo-versus-preset routing.
- [x] Implement the initial supported-field mapper and visible compatibility report; HSL/absolute RAW white balance are reported as unsupported.
- [x] Create fixtures for attribute/element forms, namespace variations, curve arrays, malformed input, partial presets, nested masks, and unknown process versions. Broaden real-world/profile fixtures in release validation.
- [x] Add IndexedDB persistence, duplicate detection, naming, deletion, and original-XMP download.
- [x] Support presets imported before a photo and session-only operation on storage failure.
- [x] Verify preset application as one undo step and no compounding when reapplied.
- [x] Verify saved presets survive reload and unsupported settings are never silently presented as applied.

**Exit condition:** a user can drop in an XMP, see the supported look applied, save it in this browser, and reuse it on another image after reloading.

### 4. Finish the beginner-facing workflow

- [x] Add native leave/refresh/close confirmation for unexported edits. Suppress it at defaults or the last exported recipe; reset the export baseline for each new image. Comparison, theme, and library-only changes do not count as edits.

- [x] Implement the final minimal desktop/mobile layout and progressive disclosure.
- [x] Make sliders, curves, crop controls, preset selection, and compare usable by keyboard.
- [x] Add JPEG export with quality selection and WebP when supported; flatten transparency against a documented white/black background for JPEG.
- [x] Handle decoding, unsupported format, storage, worker, and export failures without losing recoverable work.
- [x] Show progress during import/export and keep labels, states, and reset behavior consistent.
- [x] Document that exported images are normalized to sRGB and that source EXIF/IPTC metadata is not preserved in the first release.

**Exit condition:** a beginner can complete import → preset/manual edit → compare → export without learning implementation details.

### 5. Validate and prepare the first release

- [x] Run production build, TypeScript checks, Rust tests, focused frontend tests, and browser workflows.
- [x] Exercise Chromium, Firefox, and WebKit automation; separately record any real Safari/iOS/Android testing and do not equate WebKit automation with device validation.
- [x] Profile large photos and long slider drags; add memory limits or tiled processing if measurements require them.
- [x] Verify orientation, transparent PNGs, portrait/landscape crops, reload persistence, and preview/export color agreement.
- [x] Check focus order, keyboard interaction, touch layout, and readable compatibility notices.
- [x] Write setup instructions, supported formats, XMP compatibility details, and measured performance limits.

**Exit condition:** the core workflow passes its checks, known limitations are documented, and the production build can be served as static files.

### 6. Export edits as reusable XMP presets — after the existing roadmap

Work on this only after completing the existing roadmap above. Requested by the user on 2026-09-30.

- [x] Add “Save as preset” for the current adjustment recipe, with an editable preset name and an option to keep it in the browser's preset library.
- [x] Add “Export XMP” to download supported global adjustments as a reusable `.xmp` preset.
- [x] Share import/export mappings and document approximate Adobe equivalents. Export only settings with an intentional mapping; clearly report app-specific or unsupported adjustments instead of claiming identical Lightroom rendering.
- [x] Exclude image pixels, comparison-divider position, theme, history, source paths, crop, and rotation from the reusable preset by default.
- [x] Use correct Camera Raw/RDF namespaces, escaping, names, identifiers, process-version metadata, and tone-curve arrays.
- [x] Verify edit → export → import round-trips in this app, including partial settings, RGB curves, names with special characters, and out-of-range/unsupported fields.
- [x] Validate external-editor compatibility where available and document what was actually tested.

**Exit condition:** a user can save their look, download an XMP preset, and reapply it to another photo, with honest compatibility reporting.

### 7. Adobe `Look` and profile compatibility — feasibility and supported subset

Requested by the user after encountering unsupported `Look` settings in real presets. Investigate representative `crs:Look` blocks first; do not promise support for every Adobe profile or treat a look as an ordinary slider.

- [x] Inspect representative examples and distinguish profile references, parameterized looks, and self-contained transform data. A public Adobe Color example was inspected; the requested user-specific block was not provided.
- [x] Improve the compatibility report to identify the look/profile name and any missing dependency rather than only saying `Look` is unsupported.
- [x] Document which profile/lookup-table formats can be decoded and rendered locally with known, reusable specifications and available data.
- [x] Implement a supported subset where feasible, with explicit version/format handling, amount/blending semantics, and a documented position in the color pipeline.
- [x] Offer a local dependency import workflow if a supported look needs a separate user-supplied profile or LUT. Never fetch paths/URLs embedded in a preset automatically.
- [x] Preserve unsupported look data in the original XMP and explain when an unavailable Adobe profile prevents reproduction. Do not silently omit it while claiming full preset support.
- [x] Verify reference fixtures, neutral/identity behavior, preview/export agreement, and interaction with the existing adjustments.

**Exit condition:** feasible look types are supported and tested; unresolved or unavailable profile dependencies receive actionable compatibility messages. Broader Adobe rendering parity is not assumed.

### 8. Inspect the image — complete

- [x] Hide comparison chrome away from the image; reveal on hover, keyboard focus, and touch-only devices.
- [x] Add zoom, 100%, Fit, and bounded pan with aligned original/edited views.
- [x] Render bounded detail regions from the original pixels in the worker, with stale-result protection.
- [x] Verify view changes leave edits, history, exports, and leave warnings unchanged; reset the view for a new photo or geometry.
- [x] Verify mouse, keyboard, touch, responsive layout, and cross-browser deployment.

### 9. Saved photo sessions and a photo list — complete

- [x] Save original files, validated recipe/history snapshots, export baselines, comparison position, thumbnails, and required LUT dependencies in IndexedDB.
- [x] Offer Resume photo on return and a compact list to switch among edited photos, retaining independent edits and history.
- [x] Keep only the selected image decoded; write original files once and coalesce subsequent small document updates.
- [x] Show Saving / Saved in this browser / Session only honestly. Storage failure must not prevent editing or switching within the current tab.
- [x] Allow deliberate removal of stored photos/edits, and preserve the unexported-edit leave warning.
- [x] Verify reload, switching, history, exports, dependency restoration, storage failure, removal, and responsive/accessibility behavior; commit and deploy.

### 10. More light controls — after saved sessions

- [x] Implement Highlights, Shadows, Whites, and Blacks in the shared Rust preview/detail/export pipeline, with documented SDR semantics.
- [x] Add beginner-facing controls, history/reset support, and explicit XMP import/export mappings.
- [x] Migrate saved recipes/history from the earlier engine version with zero defaults, preserving appearance and export baselines.
- [ ] Verify tonal targeting, alpha/neutral behavior, preview/export agreement, XMP round-trips, restored sessions, and browser workflows; commit and deploy.

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

- **2026-10-01 — Saved sessions released:** [run 36910528888](https://github.com/GaryJX/still-photo-editor/actions/runs/36910528888) passed all 168 browser workflows and deployed version 1.2.0 (`cdb6684`). Live verification confirmed two independent photo sessions, edited pixels, switching, reload/Resume photo, and undo, with no page errors. Milestone 9 is complete.

- **2026-10-01 — Expanded light controls:** engine 0.7.0 adds bounded monotone Shadows/Highlights/Blacks/Whites curves between contrast and the master/RGB curves. More light controls exposes beginner-facing sliders and numeric entry; all four participate in history, reset, XMP parsing/export, and sessions. Parser version 5 reparses saved XMPs. Earlier saved recipe/history/export baselines migrate with zero defaults, preserving appearance. Twenty-four Rust tests, 21 frontend tests, and focused WebKit tonal targeting, XMP/PNG round-trip, migration, and accessibility checks pass. The full local WebKit suite passed 58 workflows with one unavailable WebP encoder skip. Cross-browser release validation and live verification are next.

- **2026-10-01 — Photo sessions and list implemented:** added local originals/edited thumbnails, independent recipe/history snapshots, comparison/export baselines, LUT dependency persistence, a compact Photos list, Resume photo, and deliberate removal. Source files are stored once; metadata saves coalesce with a one-second checkpoint during continuous edits. Saved/session-only statuses and retry follow actual transaction outcomes. Local WebKit exposed Blob/File persistence failures, so storage uses exact binary buffers; restored files, undo history, and LUT-dependent framing all pass. The full WebKit run passed 55 workflows with one unavailable WebP encoder skip; 21 frontend tests and nine focused checkpoint/comparison/session checks pass. Desktop and 320 px layouts were reviewed. Cross-browser CI and live verification are next.

- **2026-10-01 — Comparison while editing:** reveal the divider/handle/labels during actual adjustment gestures and for one second after release or the last committed change. Presets, numeric edits, framing, resets, and undo/redo share this presentation-only activity state. New photos clear it; lost window focus ends a held gesture. Hover, keyboard, and touch visibility still apply independently. The production build and focused WebKit comparison, adjustment, and curve checks pass, including clock-controlled tests of the held drag, one-second tail, timer restarts, preset application, no-op values, and photo replacement. A native range change event can precede release, so actual control pointer lifetime is tracked separately from history commits. [Run 36895037668](https://github.com/GaryJX/still-photo-editor/actions/runs/36895037668) passed all 156 browser checks and deployed `cd2c649`. Live verification confirmed a held drag stays visible beyond one second, the post-release delay, preset-triggered visibility, unchanged split position, and no page errors.

- **2026-10-01 — Version 1.1 deployed; rename outage resolved:** [run 36892524564](https://github.com/GaryJX/still-photo-editor/actions/runs/36892524564) passed 21 Rust tests, 15 frontend tests, and all 150 Chromium/Firefox/WebKit checks, then deployed `1c5b001`. The prebuilt browser image replaced the slow installation path without removing any release checks. Verified the bare public URL `https://garyjx.github.io/still-photo-editor/`: correct new-path HTML/assets, tagline, local photo import, expected edited pixels, hover-only comparison, native detail zoom, full-resolution PNG export, and cleared leave-page protection. No failed asset requests or page errors occurred. The new local folder and `origin` are verified; saved data identifiers remain compatible. Milestone 8 and the repository rename are complete. The old Pages URL should be replaced in bookmarks; reopen the new folder in editors/terminals.

- **2026-10-01 — Rename outage and CI setup delay:** the new Pages URL initially served the old artifact, whose `/wasm-image-editor/` JavaScript and stylesheet URLs return 404. The new-path build passes 49 local WebKit checks but publishing waited more than ten minutes on Ubuntu browser dependency downloads. Moving browser checks to the official Playwright 1.63.0 Noble image, with the same complete Chromium/Firefox/WebKit gate, and passing the host-built artifact to that job. The new workflow group lets this replacement pipeline start while the old installation finishes; both commits contain the same corrected application. Verify the published HTML, worker/WASM assets, edits, zoom, and export before calling the outage resolved.

- **2026-10-01 — Repository rename requested:** adopting the user's tagline, “A lightweight photo editor built directly into your browser.” Updating documentation, package/Rust metadata, and the Pages path for `GaryJX/still-photo-editor` and local `~/git/garyjx/still-photo-editor`. Keep the existing IndexedDB name and XMP namespace: browser storage shares the same origin, and previously exported presets must remain compatible. Cancel the superseded deployment built for the old path, then run the full release gate for the renamed repository. GitHub and local renames are complete, `origin` points to the renamed repository, and Pages reports the new URL. The new-path production build, 15 frontend tests, and all 49 available WebKit workflows pass (one unsupported WebP encoder skip). Push and cross-browser/live verification are next.

- **2026-10-01 — Zoom/pan implemented:** added Fit–400% zoom, a native 100% shortcut, anchored wheel zoom, bounded mouse/touch pan, two-pointer pinch, and keyboard controls. Comparison stays aligned and uses its own 44 px drag target when zoomed. Original-source detail regions are capped at 2048² per side, rendered in Rust with the existing color pipeline, and protected against stale responses. Native crop/rotation detail matches full exports pixel for pixel; view changes do not affect undo or unsaved state. New photos/framing reset to Fit. Twenty-one Rust tests, 15 frontend tests, focused zoom/comparison/geometry checks, accessibility, and recovery pass locally. Full WebKit coverage found an ambiguous status test selector, now scoped to the operation status. Reviewed light/dark desktop and 320 px layouts; corrected narrow-footer overlap. One generated 24 MP photo's 864×576 native region appeared in 176 ms including debounce and automation overhead; this is a spot check, not a benchmark. The final build and all nine targeted correction checks pass; 49 WebKit workflows passed across the suite and focused correction run, with one unavailable WebP encoder skip. Cross-browser CI and live verification are next.

- **2026-10-01 — Quiet comparison:** divider, handle, and labels now appear on image hover or keyboard focus, with persistent touch-device affordances. Explicit keyboard modality avoids a WebKit programmatic-focus issue keeping the line visible after mouse use. Production build and all three focused WebKit comparison checks pass. Zoom/pan is next.

- **2026-10-01 — Roadmap completed and released:** [CI run 36828323891](https://github.com/GaryJX/still-photo-editor/actions/runs/36828323891) passed 19 Rust tests, 13 frontend tests, and all 138 Chromium/Firefox/WebKit checks, then deployed version 1.0.0 (`b9b5f3c`). Live-site verification confirmed asset loading, WASM LUT rendering, XMP export/import with dependencies, PNG export, and correct unsaved-edit state. All requested milestones are delivered within the supported-format boundaries; missing/proprietary Adobe data is reported rather than guessed.

- **2026-10-01 — Final local release checks:** version 1.0.0 built successfully; 19 Rust tests, 13 frontend tests, and 44 WebKit workflows passed, with one conditional WebP encoder skip. Look tests include amount behavior, XMP precision/reference round-trips, legacy storage migration, missing/matching LUT files, recovery, and accessibility. A final 17-grid LUT preview measured 56 ms. The final cross-browser matrix and live-site verification are next.

- **2026-09-30 — Look/LUT milestone implemented:** added engine 0.6.0 curve-look blending and validated 1D/3D cube interpolation. Added named Adobe dependency reporting, amount capabilities, local LUT import/persistence/backup, source-hash references in exported XMP, missing-file recovery, and storage migration. Tests cover image/XMP round-trips, alpha, fixed/zero amount, legacy preset preservation, worker recovery, and active-LUT accessibility. The local 17-grid 1600×1200 LUT preview measured 57 ms. Nineteen native tests and 13 frontend tests pass; final browser release validation is next. The XMP release synchronization correction (`d25c83b`) passed CI. Unsupported Adobe camera/profile-table formats are documented rather than represented as fully supported.

- **2026-09-30 — XMP preset export:** added Save as preset with group selection, browser saving, and XMP download. Shared mapping/validation excludes photo-specific data. Standard fields use the Camera Raw integer/real schema; a validated, whitelisted precision extension keeps exact Still values without invalid native curve coordinates. Unit and browser tests cover invalid values, escaped names, partial exports, pixel round-trips, geometry exclusion, and invalid precision fallback. External Adobe application validation was unavailable and is documented. Core release validation completed before this milestone, as requested.

- **2026-09-30 — Core roadmap release validated:** CI run [36823491967](https://github.com/GaryJX/still-photo-editor/actions/runs/36823491967) passed and deployed the numeric-draft correction. Chromium, Firefox, and Linux WebKit passed the full matrix, including WebP, accessibility, recovery, memory stability, and 12/24 MP workflows. Local native tests and viewport reviews are recorded separately from real-device testing, which was not performed. Milestones 0–5 are complete within the documented SDR/browser constraints. Proceeding to XMP export, followed by `Look` support.

- **2026-09-30 — Cross-browser finding corrected:** the first Linux CI run passed 98/99 checks, including WebP export in Chromium, Firefox, and Linux WebKit. Chromium exposed an in-progress numeric value being overwritten by an unrelated render. Shared numeric inputs now preserve their draft until blur/Enter, with a regression test. Added repeated 12 MP imports and 100-event slider bursts; WASM capacity plateaus locally. The updated local suite passed 33 checks with one unavailable WebP encoder skip; CI is being rerun. Mobile crop/export layouts were visually reviewed.

- **2026-09-30 — Release checks started:** added Chromium/Firefox/WebKit browser gates before Pages deployment, retained failure artifacts, and pinned the CI runner to Ubuntu 24.04. Added automated WCAG A/AA checks for light/dark empty and loaded views plus crop/export dialogs. The checks identified low-contrast light-theme labels, which were corrected; both local accessibility workflows now pass. Cross-browser CI results are pending.

- **2026-09-30 — Recovery and mobile workflow:** introduced a worker client that rejects pending RPCs on failure, a retained source file and generation guards for safe recovery, and a Recover editor action that preserves edits/history. Added a collapsible mobile controls panel that stays expanded on desktop. Production build and 29 WebKit workflows passed, with the unsupported native WebP encoder check skipped. Recovery was tested by terminating a simulated failed worker and restoring the edited pixels/history.

- **2026-09-30 — Export formats:** added a native export dialog with PNG/JPEG and WebP when feature detection succeeds, quality selection, and white/black JPEG matte colors. The worker validates options and output MIME types, with a main-thread encoder fallback. Successful exports in any supported format clear the unsaved baseline; cancelling the dialog does not. Production build and 27 WebKit workflows passed; the WebP-specific check was correctly skipped because this WebKit build has no native WebP encoder. Crop/rotation deployment (`1341fbf`) succeeded.

- **2026-09-30 — Crop and rotation:** implemented engine 0.5.0 geometry before color processing, using one output buffer. Added a crop dialog with free resizing, aspect presets, pointer movement, keyboard/numeric positioning, cancel/apply, and quarter-turn buttons. The worker caches the matching original crop and sends it until the UI acknowledges that geometry, avoiding mismatched comparison frames when renders are superseded. Sixteen Rust tests, eight frontend tests, and all 25 functional WebKit workflows passed. Checks include crop/rotation pixel locations, original alignment, exported dimensions/pixels, cancel, and one-step undo. HSL deployment (`e30a6a6`) succeeded.

- **2026-09-30 — Color mix:** added engine 0.4.0 with eight HSL ranges, smooth interpolation between neighboring hue centers, neutral protection, and a zero-adjustment fast path. The UI exposes hue/intensity/brightness per color with resets, keyboard input, and gesture history. Parser version 2 maps all 24 corresponding XMP fields and preserves unspecified components. Fourteen Rust tests, six frontend tests, and 22 functional WebKit workflows passed across the main and focused correction runs. End-to-end checks cover targeted pixel changes, export agreement, undo, and partial/invalid XMP fields. A rounding issue at saturated endpoints was fixed by preserving no-op transforms exactly. Added a dedicated `Look` compatibility follow-up after the user's request.

- **2026-09-30 — Unsaved-edit protection:** added a conditional native `beforeunload` handler keyed to the current recipe and last successfully generated/downloaded PNG. Default settings never warn; new edits after export do, and undoing back to the export clears the warning. A new image clears the previous export baseline. Production build, six frontend tests, and all 20 functional WebKit workflows passed, including a real reload and export/reset/undo conditions. XMP import/library deployment (`80be838`) succeeded.

- **2026-09-30 — XMP import and library:** implemented namespace-aware global setting extraction, explicit range/curve validation, compatibility reports, partial application, and original-file preservation. Added IndexedDB save/load, deduplication, renaming/deletion, original-XMP download, and a session-only fallback. Eighteen functional WebKit checks passed across the main and corrected touch-test runs, plus a fresh 12/24 MP baseline. Engine 0.3.0 previews measured 17–21 ms and full-size PNG exports roughly 320/577 ms on the same M4 Max baseline. The touch test now scrolls the comparison control into view before tapping it after edits further down the mobile page.

- **2026-09-30 — Tone curves:** implemented engine 0.3.0 with validated, piecewise-linear master and RGB curves composed before saturation/vibrance. Added point creation, dragging, numeric input/output, keyboard movement, removal/reset, and undo integration. Ten Rust tests and the production build passed; browser checks verified curve composition and preview/export pixel agreement. A WebKit SVG focus issue was fixed by using the case-correct `tabindex` attribute, and keyboard checks now pass. XMP export was added to the roadmap as a later milestone at the user's request.

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
- **Published and verified:** GitHub Actions run [36815763041](https://github.com/GaryJX/still-photo-editor/actions/runs/36815763041) built and deployed commit `5283798` successfully. Verified the live site in WebKit: correct project-relative navigation, no failed assets or page errors, local photo import, the expected +1 EV pixel transform, and PNG download. The five functional WebKit workflows also passed against a local production build under `/wasm-image-editor/`. Future pushes to `main` deploy automatically.

## Reference implementation

Squoosh source reviewed at commit `e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3`:

- [Feature boundaries](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/src/features/README.md)
- [Worker bridge](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/src/client/lazy-app/worker-bridge/index.ts)
- [Rust resize implementation](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/codecs/resize/src/lib.rs)
- [Processing and caching controller](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/src/client/lazy-app/Compress/index.tsx)

Use these as architecture references. If source is reused, retain required license notices and review the relevant component's license.
