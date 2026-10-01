# Initial performance baseline

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
