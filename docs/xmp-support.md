# XMP import support

The editor imports a documented subset of Lightroom/Camera Raw preset settings. These are mappings to this editor's rendering engine, not Adobe's renderer. Compatible global settings can also be extracted from a sidecar; masks and complete per-photo projects are not restored.

| XMP field | Behavior |
| --- | --- |
| `Exposure2012` | Exposure in EV, from -4 to +4 |
| `Contrast2012` | Approximate contrast mapping, -100 to +100 |
| `Saturation`, `Vibrance` | Approximate color adjustments, -100 to +100 |
| `IncrementalTemperature`, `IncrementalTint` | Approximate relative warmth/tint, -100 to +100 |
| `ToneCurvePV2012`, `ToneCurvePV2012Red`, `ToneCurvePV2012Green`, `ToneCurvePV2012Blue` | 2–32 ordered points spanning input 0–255; piecewise-linear interpolation |
| `HueAdjustment*`, `SaturationAdjustment*`, `LuminanceAdjustment*` | Approximate color-mix adjustments for Red, Orange, Yellow, Green, Aqua, Blue, Purple, and Magenta; -100 to +100 |
| `Temperature`, `Tint`, `WhiteBalance` | Unsupported absolute RAW white balance; there is no reliable mapping without the source camera/color context |
| Grading/calibration, profiles/LUTs, highlights/shadows, clarity/dehaze, sharpening/noise reduction, grain/vignette, masks/healing, geometry | Unsupported in the current importer; listed in the compatibility report |

The parser supports attributes and element-form scalar values, namespace-prefix variations, and RDF sequence curve arrays. It reads only Camera Raw settings on top-level RDF descriptions, so exposure values inside a local mask cannot accidentally become global adjustments. It recognizes common process-version markers; unrecognized versions are flagged while explicitly supported fields retain their documented mappings. Legacy fields such as `Exposure` are not silently treated as `Exposure2012`.

Malformed XML and document-type/entity declarations are rejected. XMP files are limited to 2 MiB and 512 top-level settings. Invalid or duplicated fields are reported and omitted. Out-of-range values are not silently clamped. The importer never resolves external references.

## Applying and saving presets

Use **Import XMP** in the preset panel, or drop an `.xmp` file onto the app. Importing with a photo open applies supported settings immediately. Importing before a photo saves it for later selection.

A preset assigns only the supported settings actually present in the file. Omitted settings remain unchanged. Applying a preset is one undo step, and reapplying the same values does not compound adjustments. Expand its compatibility report to see supported, approximate, unsupported, invalid, and unrecognized-version details.

Presets are stored in IndexedDB in this browser, including the original XML, a content hash, a normalized patch, and parser-version metadata. Identical files are deduplicated. Original XML is reparsed when loaded, so stored patches do not silently keep outdated mappings. Rename and delete actions are available in the preset's menu.

When browser storage is unavailable or full, imports remain usable for the current session and the UI explains that they were not saved. Browser storage can also be cleared or evicted. **Download original XMP** backs up the exact imported file, including settings this editor cannot interpret.

## Export current edits

**Save as preset** creates an XMP from the current light/color recipe. Choose a name, select the groups to include, and save in the browser and/or download the file. Source pixels, filenames, crop/rotation, theme, comparison position, and history are excluded. Saving an XMP does not clear the unexported-image warning.

The writer shares the importer's field mappings and validates every value. Camera Raw integer fields and curve-point coordinates are emitted as integers; exposure remains a real value. Curves whose rounded input coordinates coincide are merged for the standard representation. A versioned `still:Settings` extension (`https://garyjx.github.io/wasm-image-editor/xmp/1.0/`) preserves full precision for reopening in Still. The importer validates this extension, strips unknown properties, and only overrides settings already represented by supported standard fields. Invalid precision metadata falls back to the standard XMP values and is reported.

Field types were checked against the [Exiv2 Camera Raw schema definitions](https://github.com/Exiv2/exiv2/blob/main/src/properties.cpp). Browser round-trip tests verify names, curves, partial groups, precision, and rendered pixels. Lightroom/Camera Raw application testing was unavailable; their rendering can differ from Still's documented algorithms. **Download original XMP** remains an exact backup action, separate from exporting the current recipe.

`Look`/creative-profile support is now a dedicated roadmap item. A look may require separate profile or lookup-table data, so feasibility depends on the actual preset and available dependencies. The first step is to inspect representative look blocks and improve missing-profile reporting; arbitrary Adobe profile compatibility is not promised.

## Validation

Browser fixtures cover attribute/element forms, alternate namespace prefixes, curve arrays, nested mask descriptions, unknown process versions, malformed XML/curves, invalid numbers, partial application, repeated application, undo, import before an image, duplicate files, reload persistence, renaming/deletion, exact original-file download, and session-only operation. External Lightroom/Camera Raw rendering equivalence has not been claimed or tested.
