# WASM Image Editor

A browser-based photo editor with a Rust/WebAssembly processing engine, a minimal interface, and reusable XMP presets. Images are processed on the user's device.

[Open the editor](https://garyjx.github.io/wasm-image-editor/) · [Implementation plan](PLAN.md) · [MIT license](LICENSE)

## Project status

Milestone 1 is implemented. The first working slice, branded **Still** in the interface, includes photo import, Rust/WASM exposure adjustment, original comparison, reset, and full-resolution PNG export. The local Git repository uses `main`.

[PLAN.md](PLAN.md) is the implementation roadmap, acceptance checklist, and decision log. Update it as work progresses.

## Available now

- Open or drop a JPEG, PNG, or WebP photo.
- Adjust exposure from −4 to +4 EV, with a responsive preview.
- Compare with the original and reset the adjustment.
- Export a full-size PNG while preserving transparency.
- Use the editor on desktop or a narrow screen, with keyboard-accessible controls.

Images remain on the device. The original stays unchanged. Reloading clears the editing session. Source metadata is not preserved in exported PNGs; the processing pipeline uses SDR sRGB.

XMP presets, additional light/color controls, crop, and history are upcoming milestones. The current interface contains only implemented controls.

## Planned experience

1. Drop in a photo.
2. Adjust its light and color, or drop in an XMP preset.
3. Compare with the original and undo any change.
4. Export an edited image.

Imported presets will be saved in this browser for later use. Planned XMP support covers a documented subset of Adobe settings and will not promise identical Lightroom rendering.

## Stack

- Preact, TypeScript, and Vite for the interface.
- Rust, `wasm-bindgen`, and `wasm-pack` for image processing.
- Web Worker and Comlink for processing without blocking the interface.
- Canvas for initial preview rendering; browser codecs for initial import/export.
- IndexedDB for saved presets and localStorage for small UI preferences are planned.
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

`npm run test:e2e -- --project=webkit` runs only the WebKit project. The initial validation passed six WebKit workflows; Chromium and Firefox could not launch in the development sandbox and remain unverified. WebKit automation is not a claim of real Safari or mobile-device coverage.

See [docs/processing.md](docs/processing.md) for the processing contract and [docs/performance.md](docs/performance.md) for measured results and limits.

## Publish to GitHub Pages

The repository is [GaryJX/wasm-image-editor](https://github.com/GaryJX/wasm-image-editor). The site URL is **https://garyjx.github.io/wasm-image-editor/**.

The [Pages workflow](.github/workflows/pages.yml) tests the engine and scheduler, builds Rust/WASM and the interface, and deploys the generated `dist/` artifact. Build output stays out of Git. The workflow reads the Pages base path so JavaScript, WASM, icons, and navigation work under the project URL.

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
