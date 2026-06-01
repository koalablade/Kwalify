# Hybrid scoring (scene-first)

## Pipeline

1. **hard-filters.ts** — absolute exclusions (seasonal, energy, prototype)
2. **hybrid-scoring.ts** — layered match + percentile normalization
3. Post-multipliers in `generate.ts` — freshness, reference, rediscovery boost

## Layer weights (capped at 0.4 each)

| Layer | Weight | Driver |
|-------|--------|--------|
| Scene | 0.35 | `scene-validation` + `seasonal-logic` + sonic |
| Emotion | 0.30 | `scoreSong` (audio features) |
| Genre | 0.20 | `genre-expansion-map` (title/artist/album text) |
| Memory | 0.10 | temporal memory + library signals |
| Novelty | 0.05 | jitter / discovery |

**Priority:** scene → intent → emotion → memory → genre → novelty

## API debug

`emotionalIntelligence.scoringDiagnostics` on `POST /api/generate`:

- `sceneFamily`, `excludedCount`, `exclusionReasons`
- `topScored[]` with per-layer scores
- `seasonalExclusionsSample` (christmas-in-sun leaks)

## Modules

- `seasonal-logic.ts` — sun vs christmas hard rules
- `genre-expansion-map.ts` — country/folk cluster + scene boosts
- `scene-validation.ts` — primary scene family
- `hard-filters.ts` — pre-score exclusions
