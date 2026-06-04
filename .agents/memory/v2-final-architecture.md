---
name: V2 Final Architecture
description: V2 FINAL recommender — triple-signal scoring, bucketed selection, diversity engine, sequencer. Replaced V9/V10/V11 experimental systems.
---

# V2 Final Architecture

## The Rule
All prior scoring systems (V9 ecosystem lock, V10/V11 multi-channel weights, scene gating) are bypassed. The V2 pipeline is the ONLY path from scored pool → final playlist.

## Integration point
`backend/core/playlist-pipeline.ts` — `buildPlaylistPipeline` calls `runV2Pipeline` AFTER `runScoringPipeline`. The existing `runScoringPipeline` runs first for infrastructure (genre classification, coverage state, scoringDebug). V2 then re-scores every track and takes over selection + sequencing.

## Signal formula
```
finalScore = 0.45×R + 0.35×V + 0.20×C
R = cosineSimilarity(trackEmbedding, intentEmbedding)
V = energyMatch×0.4 + moodAlignment×0.3 + audioFeatureSimilarity×0.3
C = eraMatch×0.5 + activityMatch×0.3 + sceneSoftAffinity×0.2  (scene capped at 0.10)
```

## New files
- `backend/lib/intent-parser.ts` — UserIntent type, parseUserIntent(), buildIntentEmbedding(), computeActivityMatch()
- `backend/core/v2/era-model.ts` — ERA_AUDIO_PROFILES, detectEraFromYear(), estimateEraFromAudio(), computeEraMatch()
- `backend/core/v2/triple-signal-scorer.ts` — computeR/V/C, computeV2FinalScore, scoreAllTracks()
- `backend/core/v2/diversity-engine.ts` — greedyDiversitySelection(), applyV2Diversity()
- `backend/core/v2/bucketed-selection.ts` — buildBucketedPlaylist() — 4×25% buckets
- `backend/core/v2/sequencer.ts` — sequenceTracks(), energy arc, computeSmoothnessScore()
- `backend/core/v2/v2-pipeline.ts` — runV2Pipeline() — orchestrates all V2 steps

## Absolute rules (V2 spec)
- NEVER remove tracks due to genre/scene/confidence before scoring
- ALL diversity logic post-score only (streak penalties in greedyDiversitySelection)
- NEVER allow single genre > 60% (bucketed selection + genre enforcement safety net)
- Scene influence capped at sceneSoftAffinity×0.10 → max 2% of final score

**Why:** V2 replaces "architecture" not just weights. The old approach could collapse into one genre cluster. V2's bucketed selection (25%×4) with greedy diversity guarantees multi-genre, multi-era output.

**How to apply:** If adding new scoring signals, they MUST go into R, V, or C — never as a separate multiplier. If adding new selection logic, put it in diversity-engine.ts or bucketed-selection.ts.
