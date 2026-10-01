# WASM Image Editor

A browser-based photo editor with a Rust/WebAssembly processing engine, a minimal interface, and compatible XMP presets. Images and presets are processed on the user's device.

[Open the editor](https://garyjx.github.io/wasm-image-editor/) · [Implementation plan](PLAN.md) · [MIT license](LICENSE)

## Project status

The editor, branded **Still**, now includes a draggable comparison divider, global light/color adjustments, master/RGB tone curves, undo/redo, light/dark themes, XMP import and a saved preset library, and full-resolution PNG export. The local Git repository uses `main`.

[PLAN.md](PLAN.md) is the implementation roadmap, acceptance checklist, and decision log. Update it as work progresses.

## Available now

- Open or drop a JPEG, PNG, or WebP photo.
- Adjust exposure, contrast, warmth, tint, color intensity, and vibrance, with a responsive preview.
- Edit the master and red/green/blue tone curves with draggable points, numeric values, and keyboard controls.
- Adjust hue, intensity, and brightness for eight color ranges in **Color mix**, including matching XMP HSL fields.
- Crop freely or use common aspect ratios, rotate in 90° steps, and undo framing changes. Both sides of the comparison keep the same framing.
- Drag a centered before/after divider: original on the left, edits on the right. Move fully left for all edits or fully right for the original. Touch, arrow keys, Home/End, and a recenter button are supported.
- Undo/redo edits, reset one control, or reset everything. A slider gesture is one undo step; ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z work outside text fields.
- Export PNG, JPEG, or WebP when supported by your browser. PNG/WebP preserve transparency; JPEG offers quality and white/black background controls.
- Use the editor on desktop or a narrow screen, with keyboard-accessible controls and a collapsible mobile panel.
- Apply self-contained curve looks or import 1D/3D `.cube` LUTs, control their amount, and keep their dependencies locally. See the [Look compatibility guide](docs/look-support.md).
- Switch between light and dark mode. The first visit follows your system setting; an explicit choice is remembered in this browser.
- Import or export XMP presets, apply supported settings as one undo step, and save them in this browser. Rename, delete, or download the original file from the preset menu. See the [XMP compatibility guide](docs/xmp-support.md).
- Get a native browser confirmation when refreshing, navigating away, or closing with unexported edits. No warning appears for defaults or the last exported recipe; changing the theme or comparison divider does not count as an edit.

If the processing worker stops, **Recover editor** reloads the original file retained in this tab and reapplies the current edits without clearing history. This is in-memory recovery, not a saved image session.

Images remain on the device. The original stays unchanged. Reloading clears the editing session. Source metadata is not preserved in exported PNGs; the processing pipeline uses SDR sRGB.

Leave-page protection clears after image generation succeeds and the download starts. Browsers do not expose whether a later file-save dialog was canceled. The confirmation uses `beforeunload`, so browser interaction/permission rules apply; it does not save or recover the image session.

The roadmap is implemented for the documented supported formats. See the compatibility guides for Adobe profile dependencies and browser limits. The current interface contains only implemented controls.

Use **Save as preset** to keep the current look in this browser, download it as XMP, or both. You can select light, color, curves, and color-mix groups; crop and rotation are excluded.

The comparison divider and labels appear while hovering over the photo or using the keyboard. Touch-only devices keep them visible so the control stays discoverable. Moving away hides the controls while keeping your chosen split.

## Planned experience

1. Drop in a photo.
2. Adjust its light and color, or drop in an XMP preset.
3. Compare with the original and undo any change.
4. Export an edited image.

Imported presets are saved in this browser for later use. XMP support covers a documented subset of Adobe settings and does not promise identical Lightroom rendering.

## Stack

- Preact, TypeScript, and Vite for the interface.
- Rust, `wasm-bindgen`, and `wasm-pack` for image processing.
- Web Worker and Comlink for processing without blocking the interface.
- Canvas for initial preview rendering; browser codecs for initial import/export.
- IndexedDB for saved presets and localStorage for the theme preference.
- Cargo tests, Vitest, and Playwright for focused validation.

## Development

Requires Node.js 22.12+ and Rust/Cargo (tested with Node 24.15.0 and Rust 1.92.0). Dependency versions are recorded in `package-lock.json` and `crates/image-engine/Cargo.lock`.

```sh
npm ci
rustup target add wasm32-unknown-unknown
npm run dev
```

Open the local URL printed by Vite, usually `http://127.0.0.1:5173`. `wasm-pack` is a project dependency; the first build also prepares its matching `wasm-bindgen` tool. Rust changes require rerunning `npm run wasm:build`; TypeScript and CSS changes update automatically.

```sh
npm run build       # WASM, TypeScript checks, and static production build
npm run preview     # serve the production build locally
npm run test:rust   # image-math and immutable-source tests
npm test            # latest-request scheduler tests
```

Browser checks require the Playwright browser packages and a production build:

```sh
npx playwright install chromium firefox webkit
npm run build
npm run test:e2e
```

`npm run test:e2e -- --project=webkit` runs only the WebKit project. The release matrix passes in Chromium, Firefox, and WebKit on Linux CI; local WebKit checks and viewport reviews also pass. Local Chromium/Firefox launches are restricted in this sandbox. Browser automation is not a claim of real Safari or mobile-device coverage.

See [docs/processing.md](docs/processing.md) for the processing contract and [docs/performance.md](docs/performance.md) for measured results and limits.

## Publish to GitHub Pages

The repository is [GaryJX/wasm-image-editor](https://github.com/GaryJX/wasm-image-editor). The site URL is **https://garyjx.github.io/wasm-image-editor/**.

The [Pages workflow](.github/workflows/pages.yml) tests the engine and scheduler, builds Rust/WASM and the interface, and runs Chromium, Firefox, and WebKit workflows (including accessibility checks) before deploying the generated `dist/` artifact. Build output stays out of Git. The workflow reads the Pages base path so JavaScript, WASM, icons, and navigation work under the project URL.

For the initial setup:

1. In the repository's **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source.
2. Commit the project and push `main` to GitHub.
3. Open **Actions → Deploy to GitHub Pages** and wait for the `build` and `deploy` jobs to finish.
4. Open the site URL above. Photos are still processed locally in the visitor's browser.

For future updates:

```sh
git add <changed-files>
git commit -m "Describe the change"
git push origin main
```

Each push to `main` runs the workflow automatically. It can also be started from **Actions → Deploy to GitHub Pages → Run workflow**. If a deployment fails, read the failing job's logs; the last successful site remains available.

To check the project URL locally before pushing:

```sh
APP_BASE_PATH=/wasm-image-editor/ npm run build
APP_BASE_PATH=/wasm-image-editor/ npm run test:e2e -- --project=webkit
```

This validates the production bundle under `/wasm-image-editor/`, including the worker and WASM asset paths.

## License

This project is licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.

## Inspiration

[Squoosh](https://github.com/GoogleChromeLabs/squoosh) demonstrates browser-local codecs, Rust/C++ WASM modules, worker-based processing, and before/after comparison. This project will use its architecture as a reference and introduce a separate interactive editing pipeline.
