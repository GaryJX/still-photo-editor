# Initial performance baseline

Updated engine 0.3.0 measurements (same machine, generated fixtures, and WebKit setup): 12 MP import 414 ms, preview p95 21 ms, PNG export 320 ms; 24 MP import 683 ms, preview p95 18 ms, PNG export 577 ms. WASM memory capacities remained 112.66/206.90 MB. These include the float color/curve pipeline. The original single-exposure baseline below is retained for comparison. Whole-tab peak memory and real-device performance remain unmeasured.

Recorded 2026-09-30 on an Apple M4 Max with 64 GiB RAM, macOS 15.8.1, Node 24.15.0, and Playwright 1.63.0 / WebKit 26.6. This is headless WebKit automation, not a real Safari-device benchmark.

The test uses generated PNG color gradients with varying RGB channels. These compress differently from real photographs. Ten exposure changes run after each import, followed by a full-resolution PNG export. Each source is loaded in a fresh page. PNG dimensions are verified, and smaller fixtures separately verify edited output pixels and alpha.

| Measurement | 12 MP (4000 × 3000) | 24 MP (6000 × 4000) |
| --- | ---: | ---: |
| Preview dimensions | 1600 × 1200 | 1600 × 1067 |
| Import to ready preview | 332 ms | 512 ms |
| Preview render range | 2–4 ms | 2–3 ms |
| Preview render p95, nearest-rank over 10 samples | 4 ms | 3 ms |
| Automated interaction round-trip range | 10.3–31.4 ms | 9.4–36.1 ms |
| Full-resolution PNG export/download | 199 ms | 399 ms |
| Retained source + preview in WASM | 55.68 MB | 102.83 MB |
| WASM linear memory after export | 112.66 MB | 206.90 MB |

MB means decimal megabytes. WASM linear memory is its allocated capacity after export and acts as a high-water mark; it is **not total tab memory**. Decoded browser images, JavaScript pixel arrays, canvases, encoded files, and the browser itself add allocations not included in that figure. Whole-tab peak memory remains unmeasured.

Render time covers the worker's Rust invocation and the returned JavaScript pixel buffer. The automated interaction time includes Playwright input/blur operations and waiting for the committed preview; it is not a precise hardware input-to-display measurement. Export time includes the automated click, processing, browser encoding, and reading the downloaded file. Samples are small and browser timer resolution is limited.

Raw preview render samples in milliseconds:

```text
12 MP: 3, 4, 3, 3, 2, 2, 3, 2, 3, 2
24 MP: 2, 2, 3, 2, 2, 2, 2, 2, 2, 2
```

## Reproduce

```sh
npm run build
npm run test:e2e -- --project=webkit --grep 'baseline'
```

The test prints measurements and attaches a JSON record to the Playwright result. Other configured projects can run the same test when their browser launches are available. Chromium and Firefox did not launch in the development sandbox and are unverified here. No launch restrictions were changed.

Before the first release, add real-photo fixtures with clear licenses, longer interaction runs, sustained image replacement, lower-memory devices, whole-tab memory measurements, and broader color-profile coverage. These results establish the first working path; they do not establish a mobile performance guarantee.


## Linux CI observations

The first browser-matrix run used GitHub's Ubuntu 24.04 runner, Chromium 153, Firefox 155, and WebKit 26.6. All three completed 12/24 MP imports and exports. For 24 MP images, warmed preview render samples were approximately 34–42 ms in Chromium, 32–36 ms in Firefox, and 44–68 ms in WebKit. Export workflow times (including the format dialog interaction) were approximately 243 ms, 434 ms, and 2,195 ms respectively. WASM capacity after export was 206.90 MB in each engine. These are synthetic-fixture observations, not mobile-device guarantees.

A stability workflow also repeats six 12 MP imports and sends 100 slider events per image, checking that the final state is displayed and that WASM memory capacity plateaus. Browser canvas/JavaScript allocations remain outside that capacity measurement. Automated accessibility checks cover both themes, empty/loaded views, and crop/export dialogs; manual visual review includes narrow mobile layouts.


The final version 1.0 CI run measured the active 17-grid 3D LUT at 163 ms in Chromium, 150 ms in Firefox, and 189 ms in Linux WebKit for a 1600×1200 preview. The local M4 Max/WebKit result was 56–57 ms. These are CPU/WASM timings; the interface remains on the main thread and outdated renders are discarded.
