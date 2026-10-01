# Look and LUT support

`Look` is a structured profile description, not a single adjustment slider. Some files contain a usable transform; others name a camera profile or a separate lookup table. The editor now distinguishes these cases and names missing or unsupported dependencies in the compatibility report.

## Supported

- **Self-contained Camera Raw curve looks:** a `crs:Look` with an embedded `crs:Parameters` description containing supported master/RGB `ToneCurvePV2012*` arrays, without an external camera profile, lookup-table dependency, or unsupported transform parameters.
- **Amount:** profile amount from 0–200%. `SupportsAmount=false` fixes the amount at 100%. Profiles explicitly requiring scene-referred input are not treated as rendered-RGB looks.
- **Standard `.cube` files:** standalone 1D tables with 2–65,536 entries and 3D tables with grid sizes 2–65. Domain bounds and sample counts are validated; combined shaper/3D files are rejected clearly.
- **Local reuse:** imported LUTs are saved in IndexedDB with a session fallback. Their original text can be downloaded. The database upgrade preserves existing XMP presets.
- **Image editing:** look changes participate in undo/redo, unsaved-edit protection, preview/export rendering, and worker recovery. The comparison's original side remains ungraded.

Use **Look & LUT → Import LUT**, or drop a `.cube` file onto the app. Choose files designed for standard RGB photos; log/camera-input LUTs may require transforms that this editor does not provide.

## Rendering contract

Looks run after the global light/color/curve/HSL adjustments, on floating-point encoded RGB, before final 8-bit quantization. Embedded curve looks apply their master curve followed by their channel curves. 1D LUTs interpolate each channel linearly; 3D LUTs use trilinear interpolation with red varying fastest in the file. The result is blended with the pre-look color by the amount, then clamped. Alpha is unchanged.

This is a documented rendered-RGB model, not Adobe's complete camera-profile pipeline. Even a supported curve look can render differently in Lightroom. LUT files are limited to 20 MiB, finite samples in [-16, 16], and finite domain bounds in [-65536, 65536] with increasing minima/maxima.

## XMP export and dependencies

Supported embedded curve looks are written as a standard `crs:Look`. Integer curve coordinates are accompanied by the same validated full-precision extension used for regular curves.

A selected `.cube` LUT is represented by a **Still-specific reference**, not a fake Adobe look-table ID. Other editors ignore that reference. Keep the `.cube` file with the exported XMP. In another browser, import the matching LUT and apply the preset again. The content hash identifies the required file; no path or URL is fetched automatically. The export dialog explains this dependency and lets you exclude the look group.

## Unsupported Adobe cases

The editor does not bundle or reconstruct Adobe camera profiles, DCP processing, proprietary/compressed Adobe look-table formats, arbitrary scene-referred transforms, or unsupported profile parameters. A profile name or lookup-table hash cannot supply the missing transform. These cases remain explicitly unavailable rather than being silently marked as applied.

A public [Adobe Color example](https://github.com/aftershootco/xmp/blob/ca0f6857eeae8a20eab6377dfb8256ccbb1ffed9/assets/3.xmp) references `Adobe Standard` and a `LookTable` ID alongside curve data. That establishes a dependency; applying only those curves would not reproduce the whole Adobe look. This example was inspected as a reference, not copied into the project. The user's exact preset block was not provided, so no claim is made about reproducing that particular preset.

## Validation

Tests cover 1D/3D interpolation and ordering, domains, malformed tables, amount blending, alpha preservation, embedded look parsing, named Adobe dependencies, fixed amounts, original/edited behavior, PNG and XMP round-trips, missing/matching LUT files, persistence, schema migration, and worker recovery. A 1600×1200 preview with a 17-point 3D LUT took approximately 57 ms in the recorded local WebKit run on an M4 Max; this is not a device-independent guarantee.
