# Post-crash integration checklist

Verified present in repo (deploy after `git push`):

## Tag & scene expansion

- [x] `vibe-keywords-master-tags.ts` (~400 phrases)
- [x] `vibe-keywords-master-culture.ts` (genres, decades, moods)
- [x] Merged in `emotion.ts` (`MASTER_TAG_KEYWORDS`, `MASTER_CULTURE_KEYWORDS`)
- [x] `scene-library-master.ts` merged into `scene-library.ts`
- [x] `emotion-scene-layers.ts` (golden hour, rain, fog, neon, etc.)

## V2.1 emotional intelligence engine (Cursor master prompt)

- [x] Typed graph edges (`knowledge-graph-types.ts`) — not flat `related[]`
- [x] `knowledge-graph.ts` — typed edges + **2-hop** `propagateGraph()`
- [x] `scene-canonicalizer.ts` — canonical scenes + confidence
- [x] `scene-prototypes.ts` — templates + excludes + profile seeds
- [x] `emotional-physics.ts` — emotion vector + forces + trajectory
- [x] `scene-sonic-profile.ts` / `scene-sonic-map.ts`
- [x] `intent-decoder.ts` (replaces flat intent; `human-intent.ts` re-exports)
- [x] `temporal-memory.ts` — track lifecycle phases
- [x] `negative-tags.ts` — exclusion penalties
- [x] `controlled-surprise.ts` / `surprise-engine.ts`
- [x] `moment-pipeline.ts` — unified pre-scoring order
- [x] `scoring-explanation.ts` — explainability helpers
- [x] `cross-graph.ts` — path enumeration

## Playlist generation (`generate.ts`)

- [x] `analyzeMomentPipeline()` (not broken keyword-only path)
- [x] `momentUnderstanding` in API response
- [x] `emotionalIntelligence` in API response
- [x] `explanation.knowledgeConcepts`
- [x] Sonic fit + exclusion + temporal memory in scoring
- [x] `injectControlledSurprise` (fixed post-crash)
- [x] Forgotten favourites + freshness + archaeology + chapters

## Routes

- [x] `GET /api/library/chapters`

## Docs

- [x] `TAG_SCENE_LIBRARY.md`
- [x] `PRODUCT_PROMISE.md`
- [x] `EMOTIONAL_INTELLIGENCE_ENGINE.md`
- [x] `KWALIFY_V2.md`
- [x] `EMOTION_SCENE_VISION.md`

## Crash fixes applied

- [x] Removed undefined `sceneMatchRaw` references
- [x] Replaced missing `injectEmotionalWildcards` → `injectControlledSurprise`
- [x] `momentPipeline` declared before use

## Quick API smoke test

```bash
POST /api/generate
{ "vibe": "late summer evening driving home from seeing old friends, want calm", "mode": "balanced", "length": 25 }
```

Expect: `momentUnderstanding`, `emotionalIntelligence`, `explanation.knowledgeConcepts`, `tracks[].narrativeRole`.
