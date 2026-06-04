---
name: Quality Lock Layer
description: Post-interleave 6-gate correctness enforcement layer for V3 pipeline.
---

## Location
- New file: `backend/core/v3/quality-lock.ts`
- Integration: `backend/core/v3/v3-pipeline.ts` (Stage 7.5, after `interleaveLanes()`)

## Architecture
Operates on `QualityLockRecord` (minimal slice: trackId, artistName, energy, valence, laneScore, genrePrimary).
Returns `{ trackIds: string[], diagnostics: QualityLockDiagnostics }`.
Caller maps trackIds back to original T via `trackById` Map.

## Candidate Pool Construction
Built from the union of ALL `sampledResults[].tracks` across all lanes, EXCLUDING tracks already in
the interleaved output (`interleavedIds` Set). Deduplicated by trackId keeping highest laneScore.
Sorted by laneScore desc — quality lock always refills with the highest-quality available candidate.

## Six Gates (in order)

### Gate 1 — Track dedup
Defensive pass. Removes exact duplicate trackIds. Should not fire in practice (interleaver enforces this).

### Gate 2 — Genre exclusion (context-aware)
`resolveExcludedGenres(vibe, sceneInfluenceMap)` → `Set<string>`.
- Indie/folk/acoustic/summer context + no significant urban/rhythm forces → exclude hip_hop, trap, rap
- Very warm+acoustic (warmth+acoustic > 0.38) + low energyForce → exclude metal
Hard reject: any track whose genrePrimary ∈ excludedGenres is removed.

### Gate 3 — Artist uniqueness
`maxPerArtist = targetCount <= 30 ? 1 : Math.ceil(targetCount * 0.12)`
Linear scan, keep first occurrence (interleaver already places higher-scored tracks earlier).
Fixes: Nirvana ×2, Dua Lipa ×2, Lumineers ×2 confirmed fixed.

### Gate 4 — Refill loop
After gates 1-3, if `working.length < targetCount`, pull from `candidatePool` using
`findNextCandidate()` which skips used/excluded/maxArtist-violating candidates.

### Gate 5 — Genre entropy floor
If normEntropy(genreDist) < 0.75 AND working.length >= 6:
- Find over-represented genres (> 2× ideal share)
- Find under-represented genres (in pool, < 2 in output, not excluded)
- Swap weakest (lowest laneScore) over-rep track → best under-rep candidate from pool
- Keeps at least 1 track per genre (never removes last representative)

### Gate 6 — Vibe consistency check
OUTLIER_THRESHOLD = 0.35 (avg of energy and valence deviation from target).
Finds up to 2 most-deviant tracks, swaps each if pool has a candidate with dist improvement > 0.06.

## Diagnostics Key
`qualityLock` field added to the v3-pipeline diagnostics output:
```typescript
{
  trackDuplicatesRemoved: number,
  genreExclusionsApplied: number,
  artistDuplicatesRemoved: number,
  refillCount: number,
  entropyRefillApplied: boolean,
  vibeOutliersSwapped: number,
  finalGenreEntropy: number,
  excludedGenres: string[],
  maxArtistRule: number,
}
```

## Validation Results ("Indie Summertime Drive", 25 tracks)
- artistEntropy: 1.0 (perfect — all 25 tracks from 25 unique artists) ✅
- genreEntropy: 0.904 ✅
- Artist repetition check: "No artist appears more than once" ✅
- 0 duplicate trackIds ✅

## Known Nuance
Genre exclusion is only as good as the upstream genre classifier. SICKO MODE by Travis Scott
classified as "electronic" (not hip_hop/trap) so it passes the exclusion — this is a genre taxonomy
classification issue, not a quality lock bug. The two actual hip_hop tracks in the library were
correctly excluded and replaced with refill candidates.
