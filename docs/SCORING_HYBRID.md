# Hybrid scoring (genre backbone + scene modulation)

## Pipeline

1. **user-genre-profile.ts** — classify every liked track; build taste vector
2. **hard-filters.ts** — seasonal/christmas/prototype exclusions
3. **hybrid-scoring.ts** — tri-score model + genre lock
4. **genre-coverage.ts** — min genre presence in ranked pool
5. **anti-generic-fallback.ts** — if pool thin, bias user's dominant genres
6. Post-multipliers — freshness, reference, rediscovery

## Tri-score model

```
finalScore = sceneScore×0.45 + libraryFitScore×0.35 + genreBalanceScore×0.20
```

- **Scene** — moment + blueprint instrumentation + sonic (capped, cannot fully override locked genre)
- **Library fit** — user genre vector + memory + novelty
- **Genre balance** — taxonomy + signature vs scene `genreAffinity` (floor 0.15 when confident)

See `docs/GENRE_TAXONOMY.md`.

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
