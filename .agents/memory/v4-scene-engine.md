---
name: V3 multi-lane architecture + V4 scene engine
description: V3 pipeline (multi-lane) fully replaces V2; V4 scene engine details kept for reference.
---

## V3 Multi-Lane Architecture (current hot path)

Replaces the V2 single-ranking pipeline in `playlist-pipeline.ts`.

### New files: `backend/core/v3/`
- `intent-decomposer.ts` — decomposes vibe → primary/secondary intents + ContextAnchors + SceneInfluenceMap (soft forces summing to 1.0)
- `lane-router.ts` — builds 2–5 lanes (core/emotional/motion/contrast); fallback 4-lane ensemble when intent is unclear (< 2 forces or top weight < 0.35)
- `lane-scorer.ts` — per-lane scoring with lane-specific weights; `computeInfluenceAffinity()` replaces `computeMultiSceneEcosystemScore`
- `lane-sampler.ts` — structural diversity hard caps: ≤35% genre, ≤50% energy band, ≤60% era
- `interleaver.ts` — weighted round-robin (40/25/20/15) + stabilization (max 2 consecutive same genre)
- `v3-pipeline.ts` — orchestrator; called by `playlist-pipeline.ts` as `runV3Pipeline()`

### Key decisions
- `resolveSemanticScene` is NO LONGER CALLED in the hot path. SceneInfluenceMap replaces it.
- No global ranking — each lane is a fully independent mini recommender.
- Fallback is multi-lane (mainstream/nostalgia/discovery/ambient), never a generic mood.
- V2 files (`backend/core/v2/`) remain but are out of the hot path.

**Why:** V2 assumed one correct interpretation of a prompt; V3 builds multiple valid mini-worlds and merges them, fixing genre collapse and mixed-prompt failures.

---

## V4 Scene Engine (reference — not in hot path)

### Scene count
53 total scenes (was 30). 23 added in V4:
STUDY_DEEP_FOCUS, SPACE_COSMOS, CYBERPUNK_URBAN, LUXURY_AMBITION, ADVENTURE_MOUNTAINS,
HEALING_AFTER_PAIN, HOPE_NEW_CHAPTER, REGRET_REFLECTION, LIFE_IS_CHANGING, SUMMER_BEFORE_UNI,
DRIVING_HOME_BREAKUP, FESTIVAL_SUMMER_FIELD, AFTERPARTY_COMEDOWN, BLUEGRASS_MOUNTAIN,
SOUTHERN_ROCK_HIGHWAY, INDIE_BEDROOM_LOFI, LATE_NIGHT_THOUGHTS, SLOW_MORNING_COFFEE,
TOKYO_RAIN_WALK, WALKING_RAIN_CITY, EIGHTIES_UK_SYNTH, CAMPFIRE_NIGHT, MORNING_RUN_SUNRISE.

### resolveSemanticScene
Returns `alternatives: Array<{id, label, confidence}>` (top 3 non-primary). Callers backward-compatible.

### Extra files (still exist, used by preview endpoint)
- `backend/lib/scene-fidelity.ts` — computeSceneFidelity()
- `backend/lib/genre-leak-detector.ts` — detectGenreLeaks()

### Preview endpoint
GET /generate/preview?vibe=... — synchronous, < 10ms, requires session auth.

### TypeScript gotchas
- TrackGenreClassification.genrePrimary (not rootGenre)
- EraContext.eraConfidence (not .confidence)
- antiGenres/sceneGenres must be `Set<string>`, not `Set<RootGenre>`
