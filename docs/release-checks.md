# Release validation

The release workflow builds the Rust/WASM engine and TypeScript application, runs Rust/frontend tests, then runs browser workflows in Chromium, Firefox, and WebKit on Ubuntu 24.04 before publishing Pages. A failed check prevents deployment. Traces and diagnostic results are retained for failures.

## Coverage

- Local JPEG/PNG/WebP import, EXIF orientation, malformed-file recovery, and transparent pixels.
- Light/color controls, HSL bands, master/RGB curves, numeric drafts, pointer/keyboard input, resets, and grouped undo/redo.
- Original/edited comparison, touch interaction, full-image endpoints, and matching crop/rotation.
- PNG/JPEG export, JPEG matte colors, WebP when the browser exposes its encoder, output dimensions, and preview/export pixel agreement.
- XMP attributes/elements, namespace aliases, curves/HSL, partial settings, unsupported dependencies, malformed XML, and invalid numbers.
- Preset persistence, duplicate detection, renaming, deletion, exact original-file backups, and unavailable-storage behavior.
- Native leave-page protection, exports/defaults/undo baselines, worker recovery, and responsive controls.
- Automated WCAG A/AA checks for light/dark empty and loaded views plus crop/export dialogs.
- Repeated large imports, 100-event slider bursts, and 12/24 MP performance measurements.

Local visual review covers desktop and narrow mobile viewports, including crop and export dialogs. WebKit automation and emulated viewports are not equivalent to real Safari/iOS/Android device testing. No real mobile-device coverage is claimed.

The first Linux browser-matrix run passed 98 of 99 checks and exposed a numeric-draft race in Chromium. That behavior was corrected and a regression test added. The updated matrix passed in [run 36823491967](https://github.com/GaryJX/wasm-image-editor/actions/runs/36823491967), including stability checks and WebP export in all three Linux engines.

## Limits kept explicit

- Processing is SDR sRGB. Browser decoders perform input color conversion; RAW, HDR, wide-gamut output, and exact Adobe rendering parity are outside the current engine.
- Import limits are 60 MiB compressed, 40 MP decoded, and 16,384 pixels per side. The pixel limit is checked after decoding; it does not prevent every possible browser allocation. Generated images up to 24 MP have been benchmarked.
- WASM capacity measurements exclude JavaScript, browser-image, and canvas allocations. Whole-tab peak memory and low-memory-device limits are not claimed.
- Browser storage can be unavailable, full, or cleared. Presets have a session fallback and an original-file backup action; photo sessions remain in memory.
- Native leave warnings depend on browser rules and user interaction. They do not provide crash/session recovery. A successful image download start clears the warning; a later cancelled operating-system save dialog cannot be detected.
- Unsupported XMP fields are reported. External profile or LUT references are never fetched automatically. Adobe `Look` support is handled as an explicit compatibility milestone, not assumed from the setting name.

See [processing.md](processing.md), [xmp-support.md](xmp-support.md), and [performance.md](performance.md) for the rendering contract, compatibility matrix, and measurement context.
