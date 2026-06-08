---
name: Diagnostics Panel Root Causes
description: Three confirmed bugs causing blank primary vibe, no lane/trace data, and 100% unknown genre composition in the debug panel.
---

## Bug 1 — genrePrimary missing from API tracks (ALL modes)

`formatTracksForApi` (backend/lib/generate-helpers.ts) never included `genrePrimary` in its output map. The frontend genre composition panel reads `t.genrePrimary || "unknown"` from `result.tracks` — always "unknown".

**Root path:** `classMap` is built in `playlist-pipeline.ts` line 176 and passed to V3 as `genreByTrack`, used internally only. `v3FinalScored` tracks are looked up via `sortedByTrackId.get()` — returns `ScoredLibraryTrack<T>` with no `genrePrimary`. `formatTracksForApi` output had a fixed field list with no `genrePrimary`.

**Fix applied:**
- `backend/lib/generate-helpers.ts`: added `genrePrimary?: string` to input type and `genrePrimary: t.genrePrimary ?? "unknown"` to output map.
- `backend/controllers/generation.controller.ts`: before `res.json`, enriches `finalTracks` via `userGenreProfile.trackClassifications` into `finalTracksWithGenre`, uses that in `formatTracksForApi`.

## Bug 2 — Unified debug panel gated to ?debug=1 only

`result.debug` (which triggers the rich V3.1 unified panel via `buildDebugPanel`'s `result.debug?.activePipeline` check) was only attached to the response when `req.query.debug === "1"`. Normal users always fell through to the legacy branch, which reads `v3Diagnostics.scoringDiagnostics` — a key that doesn't exist in the current `v3Diagnostics` shape. Result: empty scene, empty pool, empty genres in the legacy panel; "Primary vibe", "Lane architecture", and "Decision trace" sections simply absent.

**Fix applied:** Added a synthesis branch in `buildDebugPanel` (app.js) before the legacy fallback. Reads `result.v3Diagnostics.intentDecomposition` — if present, synthesizes a `debug`-compatible object and calls `buildUnifiedDebugPanel`, making the V3.1 unified panel render in all modes without requiring `?debug=1`.

## Bug 3 — selectionTrace vs finalDecisionTrace key mismatch

`v3Diagnostics` exposes `selectionTrace` (remapped in controller IIFE). `buildUnifiedDebugPanel` reads `v3.finalDecisionTrace`. `v3.diagnostics` (raw, debug-mode only) has both keys. For the synthesized path, `v3.finalDecisionTrace` would be empty.

**Fix applied:** Synthesis branch maps `finalDecisionTrace: vd.selectionTrace || []` in the synthesized debug object.

## Why v3 diversity metrics also worked

`v3Diagnostics` has `genreConcentration`, `explorationPressure`, `dominantGenre`, `dominantEra` at the top level, but the unified panel reads `globalDiversityMetrics.postInterleave.*`. Synthesis branch reconstructs `globalDiversityMetrics.postInterleave` from the top-level fields.
