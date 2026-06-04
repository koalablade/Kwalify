---
name: V4 scene engine
description: Details of the V4 expansion — new scenes, alternatives, fidelity score, genre leak detector, preview endpoint.
---

## Scene count
53 total scenes (was 30). 23 new scenes added in V4:
STUDY_DEEP_FOCUS, SPACE_COSMOS, CYBERPUNK_URBAN, LUXURY_AMBITION, ADVENTURE_MOUNTAINS,
HEALING_AFTER_PAIN, HOPE_NEW_CHAPTER, REGRET_REFLECTION, LIFE_IS_CHANGING, SUMMER_BEFORE_UNI,
DRIVING_HOME_BREAKUP, FESTIVAL_SUMMER_FIELD, AFTERPARTY_COMEDOWN, BLUEGRASS_MOUNTAIN,
SOUTHERN_ROCK_HIGHWAY, INDIE_BEDROOM_LOFI, LATE_NIGHT_THOUGHTS, SLOW_MORNING_COFFEE,
TOKYO_RAIN_WALK, WALKING_RAIN_CITY, EIGHTIES_UK_SYNTH, CAMPFIRE_NIGHT, MORNING_RUN_SUNRISE.

## resolveSemanticScene
Now returns `alternatives: Array<{id, label, confidence}>` (top 3 non-primary matches).
All callers are backward-compatible — new field is additive.

## New files
- `backend/lib/scene-fidelity.ts` — computeSceneFidelity() → {score 0-100, grade S/A/B/C/D/F, components, reasons}
- `backend/lib/genre-leak-detector.ts` — detectGenreLeaks() → {leakCount, leakPct, leakedGenres, severity}

## Preview endpoint
GET /generate/preview?vibe=... (requires session auth)
Returns: scene, alternatives, era, emotion, journeyArc — all synchronous regex/rule-based, <10ms.
Used by the frontend live preview panel with 400ms debounce.

## Frontend live preview
updateMoodPanel() still does instant client-side mood bars (analyzeMoodFromText).
fetchScenePreview() then fires 400ms later → updateMoodPanelFromServer(data) populates:
- #moodSceneName, #moodSceneBadges (confidence%, era, genres), #moodAltsRow/#moodAlts

## Key types
- TrackGenreClassification.genrePrimary (not rootGenre — that doesn't exist)
- EraContext.eraConfidence (not .confidence)
- antiGenres/sceneGenres Sets must be typed as Set<string> not Set<RootGenre>

**Why:** These were the compile-time gotchas discovered during V4 implementation.
