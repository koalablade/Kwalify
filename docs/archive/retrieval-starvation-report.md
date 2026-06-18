# Retrieval Starvation Report

Generated: 2026-06-14

Scope: investigate candidate starvation after subgenre retrieval tightening. This report covers retrieval-only fixes. It does not loosen all constraints, remove subgenre identity, change scoring, change recovery architecture, change benchmarks, or change UI.

## Verdict

The failures are consistent with candidate starvation after the new subgenre guard, not genre drift.

The prompt parser is working: failed prompts produce structured electronic subgenre intent. The collapse happens after retrieval when exact subgenre evidence is scarce or absent in Spotify/library metadata. The previous tightening had only two real outcomes:

1. enough exact/structured subgenre evidence exists, so use it;
2. otherwise fall back late to family-level evidence, sometimes after intermediate pools had already become too small or empty.

That was too brittle for real Spotify metadata, where artists/tracks often have broad labels like `electronic`, `techno`, or no useful D&B/tekk tags.

Low-risk starvation fixes were applied in `backend/core/playlist-pipeline.ts`:

- Added a structured retrieval fallback ladder:
  - `primary_subgenre` when exact primary subgenre count is healthy.
  - `related_subgenre` when exact primary count is low but related/secondary subgenre evidence is viable.
  - `family` when subgenre evidence is scarce.
- Kept strict subgenre identity when enough candidates exist.
- Prevented `contractGuardedScoredPool` from becoming zero when family-safe candidates still exist.
- Added diagnostics for fallback mode and candidate counts.

## Failed Prompt Intent Trace

| Prompt | genreFamilies | primarySubgenre | secondarySubgenre | subgenreTerms | activity/energy |
|---|---|---|---|---|---|
| `D&B rollers for night driving` | `electronic` | `dnb_rollers` | `dnb` | `dnb_rollers`, `rollers`, `dnb` | `driving` |
| `Industrial techno warehouse rave` | `electronic` | `rave` | `industrial_techno` | `rave`, `warehouse rave`, `industrial_techno`, `industrial techno`, `hard_techno`, `techno` | `party` |
| `Fast driving backroad tekk` | `electronic` | `hard_techno` | `schranz` | `hard_techno`, `tekk`, `schranz` | `driving`, `medium` |

Conclusion: parsing is not the starvation source.

## Starvation Point 1: Exact Subgenre Evidence Can Be Too Sparse

Exact source:

- File: `backend/core/playlist-pipeline.ts`
- Functions:
  - `trackMatchesStructuredSubgenre()`
  - `sufficientStructuredSubgenreEvidence()`
  - `buildRetrievalPools()`
- Stage: retrieval core-pool selection.

Previous candidate thresholds:

- `sufficientStructuredSubgenreEvidence(..., minimum = 12)`
- threshold formula: `min(max(4, minimum), max(4, ceil(tracks.length * 0.04)))`
- result: if structured matches were below threshold, the function returned `[]`.

Observed failure symptom:

- User-visible generation reported `Library: 0`, `After filters: 0`, `Final: 0` for niche prompts.
- This corresponds to zero usable candidates after retrieval/contract filtering, not parser failure.

Why it starved:

- Exact labels like `dnb_rollers`, `tekk`, or `industrial_techno` may not exist in Spotify metadata.
- Text fallback helps only when track names/artist genres contain those exact words.
- A library can contain compatible D&B/techno tracks but still have fewer than the strict evidence threshold.

Fix:

- Replaced one-step strict evidence with `structuredRetrievalScope()`.
- Exact thresholds now degrade in order:
  - strict primary subgenre if `primaryCount >= 30`;
  - related/secondary subgenre if `relatedCount >= 12`;
  - family-level scope otherwise.

Desired behavior now:

- If 500 industrial-techno candidates exist: use `primary_subgenre`.
- If only 20 related hard-techno candidates exist: use `related_subgenre`.
- If only 5 exact/related candidates exist: use `family`.

## Starvation Point 2: Pre-V3 Subgenre Guard Could Over-Narrow

Exact source:

- File: `backend/core/playlist-pipeline.ts`
- Variables/functions:
  - `subgenreEvidencePool`
  - `subgenreGuardActive`
  - `intentScopedPool`
  - `contractGuardedScoredPool`
- Stage: after `constrainPoolToIntentContract()`, before V3 lane routing.

Previous candidate counts/threshold:

- `subgenreEvidencePool = sufficientStructuredSubgenreEvidence(contractGuard.pool, ..., max(8, ceil(playlistLength * 0.60)))`
- For a 25-track playlist, required related evidence was at least `15`.
- If fewer than 15 structured matches existed, the guard did not activate, and later family evidence checks could still collapse the pool.

Impact:

- Prompts with sparse exact subgenre metadata could end up with:
  - `contractGuard.pool`: low but non-zero,
  - `subgenreEvidencePool`: `0`,
  - `contractEvidencePool`: `0`,
  - `contractGuardedScoredPool`: `0` if explicit family evidence was also too strict.

Fix:

- Replaced the binary guard with `structuredRetrievalScope()` at the pre-V3 stage.
- New pre-V3 thresholds:
  - `strictMinimum = max(30, playlistLength + 5)`;
  - `relatedMinimum = max(8, ceil(playlistLength * 0.60))`.
- `intentScopedPool` now uses:
  - primary subgenre pool when healthy;
  - related subgenre pool when viable;
  - family pool when subgenre evidence is scarce.

## Starvation Point 3: Positive Family Evidence Could Still Drain Sparse Pools

Exact source:

- File: `backend/core/playlist-pipeline.ts`
- Variables/functions:
  - `contractEvidencePool`
  - `explicitGenreScoredPool`
  - `contractGuardedScoredPool`
  - `hasPositiveExplicitGenreEvidence()`
- Stage: explicit genre/family guard before V3.

Previous behavior:

- For explicit genre prompts, final pre-V3 pool selected:
  - `contractEvidencePool` if non-empty;
  - else `explicitGenreScoredPool`.
- If both were empty, the pool could remain empty even when `intentScopedPool` still had family-safe candidates.

Exact zero-count failure mode:

- `contractEvidencePool.length === 0`
- `explicitGenreScoredPool.length === 0`
- `contractGuardedScoredPool.length === 0`

Why this can happen:

- `hasPositiveExplicitGenreEvidence()` intentionally rejects weak/generic metadata.
- Spotify metadata often lacks precise positive evidence for niche electronic subgenres.
- The intent could be valid, but metadata evidence was too weak.

Fix:

- Added `familyFallbackEvidencePool`.
- `contractGuardedScoredPool` now degrades:
  - `contractEvidencePool`;
  - `explicitGenreScoredPool`;
  - non-contradictory `familyFallbackEvidencePool`;
  - `intentScopedPool` as final retrieval-safe fallback.

This keeps strict evidence preferred while preventing zero candidates when family-safe candidates exist.

## Starvation Point 4: V3 Candidate Inputs Could Start Empty

Exact source:

- File: `backend/core/playlist-pipeline.ts`
- Functions/variables:
  - `candidateInputs`
  - `buildV3CandidatePool()`
  - `runV3Pipeline()`
- Stage: V3 candidate generation.

Symptoms:

- `v3CandidatePool.tracks.length === 0`
- `v3.finalTracks.length === 0`
- timeout fallback can trigger if downstream work repeatedly handles empty/near-empty pools.

Fix status:

- No V3 architecture changes were made.
- The retrieval fix prevents empty V3 inputs by ensuring `contractGuardedScoredPool` has a family-safe fallback when strict subgenre evidence is too sparse.

## Starvation Point 5: No Library Mode Search Can Still Return Sparse Verified Pools

Exact source:

- File: `backend/controllers/generation.controller.ts`
- Functions:
  - `noLibrarySearchQueries()`
  - `buildNoLibrarySpotifyCandidates()`
- Stage: Spotify-wide retrieval before classification.

Current behavior:

- Search now includes structured subgenre terms before broad family terms.
- Verified candidate threshold still requires enough genre evidence before using verified-only candidates.
- If Spotify returns too few raw candidates, the route returns `NO_LIBRARY_SPOTIFY_POOL_TOO_SMALL`.

Fix status:

- No additional No Library Mode loosening was applied in this pass.
- The current behavior is acceptable: No Library Mode should fail clearly if Spotify-wide search cannot produce enough raw candidates.

## Diagnostics Added

New retrieval diagnostics in `backend/core/playlist-pipeline.ts`:

- `retrieval.diagnostics.subgenreScopeMode`
- `retrieval.diagnostics.subgenrePrimaryCount`
- `retrieval.diagnostics.subgenreRelatedCount`
- `retrieval.diagnostics.subgenreFamilyCount`
- `intentContractGuard.subgenreFallbackMode`
- `intentContractGuard.subgenrePrimaryCount`
- `intentContractGuard.subgenreRelatedCount`
- `intentContractGuard.subgenreFamilyCount`

These identify the exact fallback level used for future live failures.

## Expected Behavior After Fix

For `D&B rollers for night driving`:

- Use `dnb_rollers` when enough exact metadata exists.
- Expand to related `rollers`/`dnb` evidence when exact count is low.
- Fall back to `electronic` family only when D&B evidence is too sparse.

For `Industrial techno warehouse rave`:

- Use `rave`/`warehouse rave` and `industrial_techno` evidence when healthy.
- Expand to `hard_techno`/`techno` related evidence when exact count is low.
- Fall back to `electronic` family only when metadata evidence is sparse.

For `Fast driving backroad tekk`:

- Use `hard_techno`/`tekk` evidence when healthy.
- Expand to `schranz`/related hard-techno evidence when exact count is low.
- Fall back to `electronic` family only when hard-techno evidence is sparse.

## Files Changed

- `backend/core/playlist-pipeline.ts`

## Validation

Required validation:

- `npm run typecheck`
- `npm run build`
