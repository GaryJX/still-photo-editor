# Working on WASM Image Editor

- Read `PLAN.md` before implementation. Follow its milestone order unless new evidence warrants a documented change.
- Update its status, acceptance checkboxes, decisions, and next action after each meaningful implementation milestone. Mark a criterion complete only when verified.
- Keep the interface minimal, accessible, and understandable to a beginner. Put advanced controls behind progressive disclosure.
- Keep image processing local. Do not add uploads, analytics, accounts, or external image services without a product decision from the user.
- Preserve the original image and use a versioned, nondestructive edit recipe. Preview and export must share processing semantics.
- Run expensive image processing in a worker. Avoid repeated full-size image copies and queued obsolete renders.
- Treat XMP as a partially supported interchange format. Use explicit field mappings, report unsupported editing settings, and never claim Lightroom parity.
- Save presets in IndexedDB with a session-only fallback if persistence is unavailable. Never make storage failures prevent editing or export.
- Add meaningful tests for image math, preset interpretation, state/history, and critical user flows. Record actual checks and any limitations in `PLAN.md`.
- Keep each change aligned with the current milestone; avoid adding GPU rendering, RAW development, AI editing, or layers before the plan calls for them.
