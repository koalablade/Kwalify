# Genre completeness system

## Stack

| Layer | File |
|-------|------|
| Taxonomy tree | `genre-taxonomy-data.ts` — 18 families, 80+ subgenres |
| Classification API | `genre-taxonomy.ts` — `genreFamily`, `primarySubgenre`, `confidenceScore` |
| Detection pipeline | `genre-detection-pipeline.ts` — metadata + artist history + audio + user bias |
| User taste vector | `user-genre-profile.ts` — full library scan |
| Pool bias | `genre-coverage.ts` — dynamic min/max bands |
| Playlist enforcement | `genre-coverage-enforcement.ts` — swaps + `genreAudit` |

## Priority order (fixed)

1. Genre identity (hard / lock ≥ 0.72)
2. Subgenre
3. Scene (soft modifier only)
4. Emotion
5. Surprise / rediscovery

## Scoring

`scene×0.45 + libraryFit×0.35 + genre×0.20` with genre floor when confidence high.

## API: `genreAudit`

On `POST /api/generate` → `libraryIntelligence.genreAudit`:

```json
{
  "detectedGenres": { "country": 0.12, "rock": 0.18 },
  "userDistribution": { ... },
  "missingGenres": ["jazz"],
  "enforcedAdjustments": [{ "genre": "country", "action": "swap_in_underrepresented", "count": 1 }],
  "finalDistribution": { "country": 0.1, "rock": 0.2 },
  "coverageTargets": [{ "genre": "country", "min": 0.05, "max": 0.3, "userShare": 0.12 }]
}
```

## Christmas

Hard-blocked outside holiday scenes (filter + hard-filters + `holidayBound`).

## Next upgrade

Store Spotify `artist.genres[]` on sync for near-perfect taxonomy on 5k–20k libraries.
