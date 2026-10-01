# WASM Image Editor

A browser-based photo editor with a Rust/WebAssembly processing engine, a minimal interface, and reusable XMP presets. Images are processed on the user's device.

## Project status

Planning complete; implementation has not started. The local Git repository uses `main`.

[PLAN.md](PLAN.md) is the implementation roadmap, acceptance checklist, and decision log. Update it as work progresses.

## Intended experience

1. Drop in a photo.
2. Adjust its light and color, or drop in an XMP preset.
3. Compare with the original and undo any change.
4. Export an edited image.

Imported presets can be saved in this browser for later use. XMP support covers a documented subset of Adobe settings and does not promise identical Lightroom rendering.

## Planned stack

- Preact, TypeScript, and Vite for the interface.
- Rust, `wasm-bindgen`, and `wasm-pack` for image processing.
- Web Worker and Comlink for processing without blocking the interface.
- Canvas for initial preview rendering; browser codecs for initial import/export.
- IndexedDB for saved presets; localStorage for small UI preferences.
- Cargo tests, Vitest, and Playwright for focused validation.

Build and development commands will be added with the first working implementation.

## Inspiration

[Squoosh](https://github.com/GoogleChromeLabs/squoosh) demonstrates browser-local codecs, Rust/C++ WASM modules, worker-based processing, and before/after comparison. This project will use its architecture as a reference and introduce a separate interactive editing pipeline.
