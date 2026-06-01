# 3-layer genre intelligence stack

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  A. Ontology (genre-ontology.ts)                        │
│     Family → Subgenre → Microstyle + cross-axis nodes   │
├─────────────────────────────────────────────────────────┤
│  B. Embeddings (genre-embeddings.ts)                    │
│     trackEmbedding[384] · genre centroids · cosine sim  │
├─────────────────────────────────────────────────────────┤
│  C. Clustering (genre-clustering.ts)                    │
│     Emergent micro-genres · cluster diversity cap       │
└─────────────────────────────────────────────────────────┘
         ↓
  genre-graph.ts — similarity + co-occurrence + transition edges
  genre-similarity-engine.ts — pool ranking
  genre-intelligence-stack.ts — orchestration
```

## Scoring (similarity pool boost)

```
score =
  genreDistance * 0.4 +
  sceneMatch * 0.3 +
  userHistoryAffinity * 0.2 +
  surpriseFactor * 0.1
```

## Hard rules

| Rule | Module |
|------|--------|
| Identity lock ≥ 0.72 | `genre-taxonomy` + hybrid scoring |
| Top-3 user genres in playlist | `genre-identity-rules` |
| Micro-cluster ≤ 32% | `genre-clustering` |
| Christmas hard-block | `hard-filters` + coverage |

## API (`libraryIntelligence.genreIntelligence`)

- `ontologyNodes` / `ontologyEdges`
- `microGenres` (discovered cluster count)
- `topMicroLabels` (e.g. `quiet melancholic country`)
- `embeddingVersion`: `deterministic-v1`

## Upgrade path

1. **OpenAI embeddings** — replace `combineTrackEmbedding()` body
2. **HDBSCAN** — replace greedy merge in `discoverMicroGenres()`
3. **Spotify artist genres** — weight 0.5 in `genre-detection-pipeline`
4. **Persist graph** — store `UserGenreLayer` per user in DB between sessions
