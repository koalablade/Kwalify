# Phase 9 — Implementation Evidence

**Date:** 2026-06-27  
**Baseline benchmark:** `reports/live-fault-diagnosis-500.json` (deploy `b6f109b`, pre-change)

## Files changed

| File | Phase | Why |
|------|-------|-----|
| `docs/phase1-editorial-architecture-audit.md` | 1 | Quantified audit before changes |
| `backend/core/editorial/intent-collapse-layer.ts` | 2, 5 | Sampler pool cap 300; editorial worlds; archetype-locked world fallback |
| `backend/core/v3/v3-sampler.ts` | 2, 7 | Interpretation presets; incremental playlist-shape multiplier during selection |
| `backend/core/v3/v3-pipeline.ts` | 2, 7 | Pass interpretation; fix `sampler_pool` trace |
| `backend/core/playlist-pipeline.ts` | 2–4 | Shared 300-track pool; 5×10=50 candidates; no short-circuit; pool cache per interpretation |
| `backend/core/editorial/pairwise-playlist-judge.ts` | 4, 6 | Shape-weighted dimensions; diverse tournament pool; learned dimension weights |
| `backend/core/editorial/pairwise-preference-weights.ts` | 6 | Preference-learning weight loader (corpus-fit ready) |
| `backend/data/pairwise-preference-weights.json` | 6 | Default dimension weights |
| `backend/core/editorial/would-i-save-evaluator.ts` | 6 | Pattern + curator combined score (non-circular) |
| `backend/core/editorial/human-playlist-patterns.ts` | 5 | Popularity curve, decade balance, tempo drift; incremental shape scoring |
| `backend/data/human-playlist-patterns.json` | 5 | Popularity curve priors |
| `backend/scripts/fit-human-playlist-patterns.ts` | 5 | Fit popularity curve from real playlist corpus |
| `scripts/scaffold-playlist-genome-dataset.mjs` | 5 | Playlist-genome corpus scaffold |
| `backend/tests/intent-collapse-layer.test.ts` | 8 | Broad pool + intent-pure head assertion |

## Architectural shift (completed)

**Before:** Retrieve → rank top ~25 → score-sort → sampler on tiny pool → scalar-gate tournament (often 1 candidate via short-circuit)

**After:**

```
Retrieve (shared pool, up to 300 intent-viable)
  ↓
5 editorial interpretations × 10 sampler seeds = 50 candidate playlists
  ↓
Sampler optimises combination (artist spacing, popularity curve, transitions)
  ↓
Pairwise tournament (1 champion per interpretation + wildcards)
  ↓
Winner
```

No new pipeline stages. No gate relaxation. Short-circuit removed.

## Tunables (env)

| Variable | Default | Purpose |
|----------|---------|---------|
| `EDITORIAL_MAX_CANDIDATES` | 50 | Cap total candidate playlists |
| `EDITORIAL_SAMPLER_VARIANTS` | 10 | Seed variants per interpretation |

## Tests (local)

- `npm run test:editorial-roi` — 4/4 pass
- `npm run test:intent-collapse-layer` — 12/12 pass
- `npm run build` — pass

## Benchmark delta

**Requires re-run on production** (not executed in this session):

```powershell
npm run benchmark:live-fault-500
npm run benchmark:live-human-100
```

Compare vs baseline:

| Metric | Baseline (500-run) | Target post-change |
|--------|-------------------|-------------------|
| Success rate | 63.2% | ≥63% (no regression) |
| humanSaveable | 60.2% | ≥60% |
| intent pool collapse | 24.6% | ↓ (world routing + 300 pool) |
| sampler telemetry | 0% reported | >0% (trace fix + 50 runs) |
| candidate diversity | ~identical slices | distinct seeds + interpretations |
| genre_specific success | 10% | ↑ |

## Remaining weaknesses

1. **No real playlist genome corpus** — scaffold only; collect 5k–20k playlists and run `npm run fit:human-playlist-patterns`
2. **Pairwise weights are priors** — need human A/B label corpus to replace `pairwise-preference-weights.json`
3. **50 V3 invocations per prompt** — latency cost; tune via `EDITORIAL_MAX_CANDIDATES` for dev
4. **Live validation pending** — intent collapse and genre prompts need post-deploy 500-run

## Revert criteria

If post-deploy benchmarks show success rate or humanSaveable drops >5pp, or blind pairwise win rate drops → revert 50-candidate expansion first; keep trace fix, shape scoring, and world routing if collapse improves.
