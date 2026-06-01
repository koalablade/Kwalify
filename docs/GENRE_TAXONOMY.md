# Genre taxonomy backbone

## Architecture shift

**Before:** scene → emotion → keywords (genre as weak labels)  
**Now:** user genre vector + per-track taxonomy → scene modulates on top

## Modules

| File | Role |
|------|------|
| `genre-taxonomy.ts` | Root/subgenre/micro classification + confidence + holiday lock |
| `genre-signature.ts` | Acoustic/storytelling/twang/synth fingerprint |
| `user-genre-profile.ts` | Vector from full liked library |
| `genre-coverage.ts` | Min/max genre presence per playlist |
| `anti-generic-fallback.ts` | Country/rock fallback instead of generic chill |
| `hybrid-scoring.ts` | scene×0.45 + library×0.35 + genre×0.20 |

## Genre lock

When `confidenceScore >= 0.72`, scene influence on that track is capped (~60% lock) so sunny vibes cannot pull locked christmas/country tracks off-axis.

## Scene blueprints

`scene-prototypes.ts` → `blueprint.genreAffinity`, `instrumentationBias`, `season`, `memoryType`.

## API

- `libraryIntelligence.userGenreVector`
- `libraryIntelligence.dominantGenres`
- `emotionalIntelligence.scoringDiagnostics` — tri-scores + `genrePrimary` per track debug

## Limitation

Genre still inferred from **metadata + audio features** until Spotify genre IDs are stored on sync.
