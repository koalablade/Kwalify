---
name: Semantic scoring engine overhaul
description: New 6-channel scoring weight model; semantic ecosystem score is the primary ranking signal at 40%.
---

## Weight model (SCORING_WEIGHTS in genre-constraints.ts)
```
semantic:  0.40  ← PRIMARY — scene-driven genre ecosystem fit
emotion:   0.20
scene:     0.15
aesthetic: 0.10
library:   0.10
genre:     0.05  ← was previously the dominant signal; now just personalisation floor
```

## Key files changed
- `backend/lib/semantic-scene-engine.ts` — canonical scene vectors, computeSemanticEcosystemScore, computeNegativePenalty, computeEnergyFit, resolveSemanticScene
- `backend/lib/hybrid-scoring.ts` — TriScores extended with semanticEcosystemScore / aestheticScore / negativePenalty; combineTriScore uses new weights; percentile normalisation added for semantic/aesthetic
- `backend/core/genre-intelligence/genre-constraints.ts` — SCORING_WEIGHTS, MAX_SCENE_SCORE_INFLUENCE=0.55, DOMINANT_ECOSYSTEM_FLOOR=0.70

## New SceneFamily types
`rural_countryside` and `urban_late_night` added to SceneFamily union in scene-validation.ts.
Canonical scene map updated to route dirt_road_sunset / rainy_city_lights / city_after_midnight etc. to correct families.

## Scene prototypes added
DIRT_ROAD_SUNSET, PETROL_STATION_2AM, MOTORWAY_NIGHT, RAINY_CITY_LIGHTS, SUMMER_EVENING_COUNTRYSIDE, DRIVING_HOME_BREAKUP — all inside SCENE_PROTOTYPES Record (file had structural bug where they landed outside the object; fixed).

## Debug panel
Frontend app.js: add `?debug=1` to URL to see scoring diagnostics panel after generation (scene matched, model weights, boosted/suppressed genres, genre distribution, top scored tracks).

**Why:** Semantic/scene interpretation needs to be the PRIMARY ranking signal because pure genre-library affinity caused playlists to ignore the described scene and just return most-listened-to genres.
