---
name: Pipeline audit — isUnclearIntent & genre taxonomy bugs
description: Four bugs found and fixed during "Indie Summertime Drive" full pipeline audit.
---

## Bugs found and fixed

### Bug 1 — "summertime" not matching warmth force (intent-decomposer.ts)
Warmth INFLUENCE_PATTERN used `\bsummer\b` — word boundary fails on compound words like "Summertime"
("t" follows "summer" so no right boundary). Changed to `summer(?:time|y)?` and `sun(?:ny|shine)?`.

**File**: `backend/core/v3/intent-decomposer.ts`, `INFLUENCE_PATTERNS` → warmth entry.

### Bug 2 — "indie" keyword produces zero influence forces (intent-decomposer.ts)
`GENRE_FORCE_INJECTIONS` had entries for country, jazz, blues, hip-hop, edm, classical, folk, metal,
soul, latin, reggae, k-pop — but nothing for "indie" / "alternative". Prompts like "Indie Summertime
Drive" produced only `driving: 1.0` and triggered the fallback ensemble.
Added entry: `{ hopeful: 0.55, freedom: 0.50, acoustic: 0.35, energy: 0.30 }` for indie/alternative patterns.

**File**: `backend/core/v3/intent-decomposer.ts`, `GENRE_FORCE_INJECTIONS` — new entry at end of array.

### Bug 3 — `isUnclearIntent` misfires for rich multi-force vibes (intent-decomposer.ts)
`isUnclearIntent` returns `forces.length < 2 || topWeight < 0.35`. After fixes 1+2, "Indie Summertime
Drive" correctly produced 6 forces but the top weight was only 0.286 (well-distributed), causing the
`topWeight < 0.35` branch to fire and route to the generic fallback ensemble instead of adaptive lanes.
Fix: added `if (forces.length >= 4) return false` guard before the threshold check.

**Why**: The `topWeight < 0.35` condition was designed for single-force ambiguous prompts. It must not
penalise multi-dimensional, well-specified prompts that legitimately spread influence across many forces.

**File**: `backend/core/v3/intent-decomposer.ts`, `isUnclearIntent()`.

### Bug 4 — Very high-acousticness indie-folk misclassified as "country" (genre-taxonomy.ts)
`inferGenreFromAudioOnly` and `applyAudioGenreHeuristics` both mapped acousticness > 0.58 with low
energy/valence to "country" regardless of how high acousticness was. Bon Iver (a=0.87) got "country"
with confidence 0.92. Fix: when a > 0.76 (extreme acousticness), route to "folk/singer_songwriter"
instead of "country/folk_country" because country artists pair acoustic with higher danceability/valence.

**Files**:
- `backend/lib/genre-taxonomy.ts`, `inferGenreFromAudioOnly()` — added `a > 0.78 ? "folk" : "country"` branch.
- `backend/lib/genre-taxonomy.ts`, `applyAudioGenreHeuristics()` — added `a > 0.76` escape hatch to folk/indie_folk.

## Validation
After all 4 fixes, trace for "Indie Summertime Drive" shows:
- `isUnclearIntent: false` ✅
- Adaptive 5-lane set active (core, motion_high, emotional_split, exploration, contrast) ✅
- sceneInfluenceMap: driving(0.286) warmth(0.229) hopeful(0.157) freedom(0.143) acoustic(0.1) energy(0.086) ✅
- genreEntropy: 0.918 (was 0.891), artistEntropy: 0.991 ✅
- No duplicate trackIds, no missing fields, no unknown genres ✅

## Trace script
`audit-trace.mjs` at project root — run with `node audit-trace.mjs`. Uses 78-track synthetic library,
exercises full V3 pipeline and prints staged diagnostics.
