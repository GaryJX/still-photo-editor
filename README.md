# Still Photo Editor

A lightweight photo editor built directly into your browser.

Still combines a Rust/WebAssembly processing engine, a minimal interface, and compatible XMP presets. Images and presets are processed on your device.

[Open the editor](https://garyjx.github.io/still-photo-editor/) · [Implementation plan](PLAN.md) · [MIT license](LICENSE)

## Project status

Still includes a hover-revealed comparison divider, zoom and pan, global light/color adjustments, master/RGB tone curves, crop/rotation, undo/redo, light/dark themes, XMP import/export, a saved preset library, local LUTs, and full-resolution image export. The local Git repository uses `main`.

[PLAN.md](PLAN.md) is the implementation roadmap, acceptance checklist, and decision log. Update it as work progresses.

## Available now

- Open or drop a JPEG, PNG, or WebP photo. Use **Photos** above the image to switch among your photos, with independent edits, undo/redo, and comparison positions.
- Save photo sessions automatically in this browser. On return, choose **Resume photo**, or reopen another photo from the list. Edited thumbnails help you find them.
- Adjust exposure, contrast, warmth, tint, color intensity, and vibrance, with a responsive preview. Expand **More light controls** for Highlights, Shadows, Whites, and Blacks; those settings also import/export through XMP.
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

If the processing worker stops, **Recover editor** reloads the original file retained in this tab and reapplies the current edits without clearing history. Saved sessions also retain the original compressed file, edits/history, framing, export baseline, and LUT dependencies for later reopening. Only the selected photo stays decoded between edits.

Images remain on the device. The original stays unchanged. Wait for **Saved in this browser** before relying on session recovery. **Session only** means the latest work is retained in the current tab; use **Retry saving** in the photo list after freeing storage. Source metadata is not preserved in exported PNGs; the processing pipeline uses SDR sRGB.

Leave-page protection clears after image generation succeeds and the download starts. Browsers do not expose whether a later file-save dialog was canceled. The confirmation uses `beforeunload`, so browser interaction/permission rules apply. The selected photo still warns about unexported edits, and inactive photos warn if their unexported edits have not been saved. Browser saving is separate from exporting an image.

The roadmap is implemented for the documented supported formats. See the compatibility guides for Adobe profile dependencies and browser limits. The current interface contains only implemented controls.

Use **Save as preset** to keep the current look in this browser, download it as XMP, or both. You can select light, color, curves, and color-mix groups; crop and rotation are excluded.

The comparison divider and labels appear while hovering over the photo, using the keyboard, or making edits. They stay visible throughout an adjustment gesture and for about one second after the last edit or preset application. Touch-only devices keep them visible so the control stays discoverable. Moving away hides the controls while keeping your chosen split.

Use **+ / −**, the mouse wheel over the photo, or a two-finger touch pinch to zoom. **100%** shows one source pixel per CSS screen pixel; **Fit** returns to the whole photo. When zoomed, drag the photo to pan and drag the divider to compare. Keyboard users can focus the zoomed image and use arrow keys to pan, +/− to zoom, and 0 to fit. Zoom ranges from Fit to 400%; a new photo, crop, or rotation resets the view. Scroll outside the image to move the page; Ctrl/Cmd-wheel keeps browser zoom.

Zoomed detail comes from the original pixels. View changes never alter the recipe, history, XMP presets, export dimensions, or leave-page protection.

Use the removal control in **Photos** to delete a photo session from browser storage. It does not delete your original file or your independently saved presets/LUTs. Browser storage can be cleared or evicted, so export images you want to keep; this is not cloud backup.

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

The repository is [GaryJX/still-photo-editor](https://github.com/GaryJX/still-photo-editor). The site URL is **https://garyjx.github.io/still-photo-editor/**.

The repository was renamed from `wasm-image-editor`. Update bookmarks to the new Pages URL and reopen the local project at `~/git/garyjx/still-photo-editor`. GitHub redirects old repository links, but the old Pages URL is not a permanent redirect. Saved browser presets and LUTs remain available on the same browser/origin; existing XMP files remain compatible.

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
APP_BASE_PATH=/still-photo-editor/ npm run build
APP_BASE_PATH=/still-photo-editor/ npm run test:e2e -- --project=webkit
```

This validates the production bundle under `/still-photo-editor/`, including the worker and WASM asset paths. To serve that build manually, use `APP_BASE_PATH=/still-photo-editor/ npm run preview` so the preview server uses the same path.

## License

This project is licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.

## Inspiration

[Squoosh](https://github.com/GoogleChromeLabs/squoosh) demonstrates browser-local codecs, Rust/C++ WASM modules, worker-based processing, and before/after comparison. This project will use its architecture as a reference and introduce a separate interactive editing pipeline.
