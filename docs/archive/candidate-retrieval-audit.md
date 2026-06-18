# Candidate Retrieval Precision Audit

Generated: 2026-06-14

Scope: candidate retrieval root cause audit for remaining prompt drift. This audit intentionally excludes V3 redesign, scoring rewrite, benchmark changes, recovery changes, and UI changes.

## Verdict

Candidate retrieval was still too broad after the identity work.

Structured intent was present, but the retrieval contract mostly consumed only root genre families. For subgenre prompts like D&B, techno, trance, and pop punk, unrelated candidates first entered at the retrieval pool construction stage because `electronic`, `rock`, or `metal` family membership was enough to enter the core universe. Subgenre identity then acted mostly as a ranking/order bias rather than a pool-shaping constraint.

Low-risk retrieval-only fixes were applied:

- `backend/core/playlist-pipeline.ts`: added structured subgenre evidence matching to retrieval contract scoring.
- `backend/core/playlist-pipeline.ts`: made retrieval `core` prefer subgenre-matched candidates when enough evidence exists.
- `backend/core/playlist-pipeline.ts`: added a pre-V3 subgenre guard so the candidate universe narrows to subgenre evidence when the library has enough matching candidates.
- `backend/controllers/generation.controller.ts`: made No Library Mode Spotify search expand from structured subgenre terms before broad family terms.

## Prompt Intent Trace

| Prompt | genreFamilies | primaryGenre | primarySubgenre | secondarySubgenre | mood/activity/era |
|---|---|---|---|---|---|
| D&B rollers for night driving | electronic | electronic | dnb_rollers | dnb | activity: driving |
| industrial techno warehouse rave | electronic | electronic | rave | industrial_techno | mood: energised, activity: party |
| liquid D&B late night | electronic | electronic | liquid_dnb | dnb | no mood/activity/era |
| hardgroove warehouse techno | electronic | electronic | hardgroove | industrial_techno | no mood/activity/era |
| melodic trance sunset drive | electronic | electronic | trance |  | mood: warm, activity: driving, energy: medium |
| 90s boom bap hip hop | hip_hop | hip_hop | boom_bap |  | era: 1990-1999 |
| 2000s pop punk gym | pop, rock | rock | pop_punk | punk | mood: energised, activity: gym, energy: high, era: 2000-2009 |

Notes:

- `melodic trance sunset drive` still lacks a first-class `melodic_trance` subgenre, so retrieval can only narrow to `trance`.
- `industrial techno warehouse rave` resolves `rave` as primary and `industrial_techno` as secondary. That is defensible for a warehouse rave phrase, but it can soften industrial-techno precision.

## Retrieval Flow

Current generation flow:

1. `backend/core/scoring-engine/scoring-pool-cap.ts` caps the liked-song library before full scoring.
2. `backend/core/playlist-pipeline.ts` runs full scoring and creates `scoring.sorted`.
3. `backend/core/playlist-pipeline.ts` builds retrieval pools in `buildRetrievalPools()`.
4. `backend/core/playlist-pipeline.ts` flattens retrieval pools into `pooledCandidates`.
5. `backend/core/playlist-pipeline.ts` applies `enforceIntentContract()` and `constrainPoolToIntentContract()`.
6. `backend/core/playlist-pipeline.ts` routes `contractGuardedScoredPool` into V3 candidate inputs.
7. `backend/controllers/generation.controller.ts` uses `buildNoLibrarySpotifyCandidates()` for Spotify-wide candidate search when No Library Mode is enabled.

Existing diagnostics expose retrieval pool top-20 samples through `retrievalPoolsDetailed`, but not top 500 before ranking or top 100 before finalisation. That observability gap made it harder to see broad-pool drift directly.

## Issue 1: Core Retrieval Used Family Matching Only

Exact source:

- File: `backend/core/playlist-pipeline.ts`
- Function: `buildRetrievalPools()`
- Stage: retrieval pool construction
- Previous behavior: `core` was built from `genreMatched`, where `genreMatched` only checked `trackMatchesGenreFamilies(track, classMap, contract.genres)`.

Impact:

- D&B prompts admitted all `electronic` candidates into the core pool.
- Techno prompts admitted unrelated `electronic`, `house`, `trance`, and broad EDM candidates.
- Pop punk prompts could admit broad `pop` and `rock` candidates before subgenre identity had a chance to dominate.
- Subgenre identity influenced order via `identityTermScore()`, but broad family membership still shaped the candidate universe.

Fix applied:

- Added `trackMatchesStructuredSubgenre()`.
- Added `sufficientStructuredSubgenreEvidence()`.
- `buildRetrievalPools()` now prefers a subgenre-matched core source when enough subgenre evidence exists, falling back to family matching for sparse libraries.

## Issue 2: Intent Contract Scoring Ignored Structured Subgenre Fields

Exact source:

- File: `backend/core/playlist-pipeline.ts`
- Functions: `enforceIntentContract()`, `intentContractFit()`
- Stage: contract ranking and contract guard before V3

Previous behavior:

- `enforceIntentContract()` awarded score for family, era, mood, activity, energy, and context.
- It did not award contract score for `primarySubgenre`, `secondarySubgenre`, or `subgenreTerms`.
- `intentContractFit()` counted `subgenre` as an explicit dimension but did not evaluate whether a track matched that subgenre.

Impact:

- Tracks could survive retrieval because they matched `electronic` even when they missed `liquid_dnb`, `dnb_rollers`, `hardgroove`, or `industrial_techno`.
- Candidate pools understood the prompt broadly but could feel sourced from the wrong musical universe.

Fix applied:

- `intentContractFit()` now includes structured subgenre evidence as an active fit dimension.
- `enforceIntentContract()` now gives contract-fit credit for structured subgenre matches.
- A pre-V3 `subgenreGuardActive` path narrows `contractGuardedScoredPool` to subgenre-evidence candidates when the candidate pool has enough evidence.

Diagnostics added:

- `intentContractGuard.subgenreGuardActive`
- `intentContractGuard.subgenreEvidencePoolCount`

## Issue 3: Pre-Scoring Pool Cap Preserved Family, Not Subgenre

Exact source:

- File: `backend/core/scoring-engine/scoring-pool-cap.ts`
- Function: `capTracksForHybridScoring()`
- Stage: pre-scoring pool cap

Current behavior:

- `explicitGenreFamilies()` extracts root families from the prompt.
- `matchesExplicitFamily()` considers family and subgenre fields, but only against the root-family set.
- Techno has a special identity reserve, but D&B, trance, boom bap, pop punk, and metal subgenres do not have a generic subgenre reserve at this stage.

Impact:

- Large libraries can lose specific subgenre candidates before full scoring if broad family/emotion signals dominate.
- D&B and trance are most exposed because they live under `electronic`, where many unrelated tracks compete.

Fix status:

- Not changed in this pass. A generic subgenre reserve in `scoring-pool-cap.ts` would be retrieval-only, but it touches pre-scoring cap behavior and should be handled separately after live diagnostics confirm starvation at this exact stage.

## Issue 4: No Library Mode Spotify Search Expanded From Broad Family Terms

Exact source:

- File: `backend/controllers/generation.controller.ts`
- Functions: `noLibrarySearchQueries()`, `buildNoLibrarySpotifyCandidates()`
- Stage: Spotify-wide retrieval before classification

Previous behavior:

- No Library Mode queries started with the raw prompt and then expanded using root-family terms.
- For `electronic`, query expansion included broad terms such as `electronic`, `edm`, and `dance`.
- For subgenre prompts, this could inject unrelated electronic search results before genre verification.

Impact:

- D&B prompts could receive techno/EDM candidates from broad electronic search terms.
- Techno prompts could receive unrelated dance/electronic tracks.
- Verification later could reject some tracks, but the initial universe was already noisy.

Fix applied:

- `noLibrarySearchQueries()` now accepts structured subgenre terms.
- `buildNoLibrarySpotifyCandidates()` passes parsed `subgenreTerms`.
- Search expansion now adds subgenre-specific queries before family-term expansion.

## Issue 5: Liked-Song Expansion Can Still Introduce Parent-Family Siblings

Exact source:

- File: `backend/core/playlist-pipeline.ts`
- Functions: `buildRetrievalPools()`, `flattenRetrievalPools()`, candidate input construction
- Stage: retrieval flattening and V3 candidate input construction

Current behavior:

- Retrieval uses multiple pools: `core`, `anchor`, `adjacent`, `bridge`, `energyArc`, and `discovery`.
- `strict_intent` uses `core`, `anchor`, and `energyArc`.
- `adjacent_bridge` and `discovery_energy_arc` intentionally widen candidate inputs.

Impact:

- Even when `core` is subgenre-accurate, anchor/energy/discovery can reintroduce broad parent-family tracks.
- This contributes to cross-playlist overlap and wrong-universe feel when generic high-score tracks repeatedly appear.

Fix status:

- Partially improved by the pre-V3 subgenre guard, which narrows `contractGuardedScoredPool` when enough evidence exists.
- No architecture changes were made to remove adjacent/bridge/discovery pools.

## Top 500 / Top 100 Observability

Requested traces:

- Top 500 candidates before ranking.
- Top 100 candidates before finalisation.

Current state:

- `retrievalPoolsDetailed` exposes top 20 per retrieval pool.
- `waterfall` exposes counts.
- `removalReasons` exposes stage counts.
- Full top-500/top-100 snapshots are not currently logged or returned.

Impact:

- We can infer the root cause from source and existing top-20 diagnostics, but cannot directly inspect top-500/top-100 without adding debug-only diagnostics.
- Adding those diagnostics would be low-risk observability, but it was not required to fix the retrieval contract issue and was not added in this pass to keep scope tight.

## Final Root Cause

The remaining prompt drift was caused by a mismatch between structured intent and retrieval enforcement:

- Intent extraction preserved subgenres.
- Coherence and finalisation consumed identity terms.
- Retrieval still admitted candidates primarily by root family.

That meant playlists often started from the wrong musical universe and relied on later ranking/finalisation to recover. The applied changes move subgenre precision earlier, before V3 lane routing.

## Expected Quality Impact

Expected improvements:

- D&B prompts should start from more D&B-specific candidates instead of broad electronic candidates.
- Techno prompts should prefer hardgroove/industrial/schranz/warehouse-rave candidates earlier.
- Pop punk and boom bap prompts should preserve subgenre evidence before V3.
- Cross-playlist overlap should reduce modestly because generic parent-family tracks lose early-pool gravity.

Residual risks:

- If a user's library has sparse subgenre metadata, fallback still uses family-level retrieval to avoid underfilling.
- `melodic trance` remains broad because the taxonomy currently parses it as `trance`, not `melodic_trance`.
- Pre-scoring pool cap still does not have a generic subgenre reserve.

## Validation

Post-fix validation:

- `npm run typecheck`: pass
- `npm run build`: pass
