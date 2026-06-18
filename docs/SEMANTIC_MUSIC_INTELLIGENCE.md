# Kwalify Semantic Music Intelligence

Library-first track understanding layer. Improves narrative, cinematic, and atmospheric prompts by enriching **tracks** (not prompts) and scoring retrieval against scene profiles.

## Architecture

```
Sync / backfill
  → track metadata + audio features + taxonomy classification
  → deterministic semantic enrichment (cultural tags, scene vectors, themes)
  → persist liked_songs.semantic_profile
  → build artist ecosystem graph → user_taste_graph

Generation
  → prompt → PromptSceneProfile (lexicon + dominant-intent scene splits)
  → library tracks → TrackSemanticProfile (cached / DB)
  → retrieval boost: scene overlap + cultural + themes + ecosystem adjacency
  → capped boost; dominant-emotion guard reduces drift
```

## Track semantic profile

Stored on `liked_songs.semantic_profile` (jsonb):

| Field | Example |
|-------|---------|
| `culturalTags` | neon, urban, late-night, nostalgic |
| `scene.places` | city, motorway, garage |
| `scene.times` | night, late-night |
| `scene.activities` | driving, repairing |
| `scene.weather` | rain |
| `scene.atmospheres` | lonely, reflective |
| `themes` | night, travel, loss |
| `sceneConcepts` | late-train-home, warehouse-rave |
| `eras` | 1990s, 2000s |

Enrichment is **deterministic** (lexicon + audio heuristics + genre-scene hints). No LLM track selection.

## Artist ecosystem graph

`backend/lib/artist-ecosystem-graph.ts` seeds scene-coherent ecosystems (e.g. Burial / Four Tet / Jamie xx / Mount Kimbie) and augments with library co-occurrence. Persisted in `user_taste_graph.genre_weights.artistEcosystem`.

## Retrieval integration

`buildRetrievalPools` in `playlist-pipeline.ts` adds `semanticSceneBoost` (max 0.28 library, 0.14 non-library) only when the prompt has narrative scene signals. Explicit dominant emotion caps boost at 0.18.

Intent preservation remains primary: semantic matching never bypasses genre/emotion contract filters.

## Non-library mode

Reuses enrichment and scene scoring on candidate metadata with a lower boost cap. Full-catalog semantic indexing is out of scope; library mode is the product differentiator.

## Operations

- **Sync**: new tracks enriched on insert; post-sync batch backfill via `enrichLibrarySemanticProfiles`
- **Cache**: `semantic-profile-store` in-memory map per user (6h TTL)
- **Backfill**: `backfillMissingSemanticProfiles(userId)` for stale rows

## Benchmarks

```bash
npm run benchmark:semantic-scenes
npm run ci:semantic-scenes
```

Prompts: Tokyo at 3am, rainy motorway, Volvo garage, empty city streets, warehouse rave, last train home, post-club solitude, urban nostalgia.

Metrics: scene survival, atmosphere survival, semantic coherence, ecosystem consistency, prompt uniqueness signature.

## Schema

```sql
ALTER TABLE liked_songs ADD COLUMN semantic_profile jsonb;
ALTER TABLE liked_songs ADD COLUMN enrichment_version text;
ALTER TABLE liked_songs ADD COLUMN enriched_at timestamp;
ALTER TABLE liked_songs ADD COLUMN primary_artist_id text;
ALTER TABLE liked_songs ADD COLUMN artist_ids jsonb;
```

Applied automatically via `backend/lib/db-init.ts` on boot.
