# Tag & scene library

## Structure

| File | Contents |
|------|----------|
| `vibe-keywords-master-tags.ts` | Time, weather, driving, transit, places, seasons, social, life, contradictions, archaeology |
| `vibe-keywords-master-culture.ts` | Decades, genres, moods, gaming, internet, travel, car culture |
| `scene-library-master.ts` | Compound experience scenes |
| `knowledge-graph.ts` | Linked concepts (motown → soul → nostalgia → driving…) |
| `emotion-scene-layers.ts` | Independent time / place / motion detection |

All master keywords merge into `emotion.ts` `VIBE_KEYWORDS`. Scenes merge into `SCENE_LIBRARY`.

## Knowledge graph (V2 — typed edges + 2-hop)

Nodes use **typed edges** (`amplifies`, `soundtrack_to`, `transitions_to`, …), not flat `related[]`.

`propagateGraph()` walks **2 hops** into the emotion profile and journey arc.

Example:

`late summer evening, driving home from seeing old friends`

→ `late_summer_friends` —soundtrack_to→ `driving`, —amplifies→ `nostalgia`, —amplifies→ `warmth`

API: `explanation.knowledgeConcepts[]` and `emotionalIntelligence.graphHops[]`

See `docs/EMOTIONAL_INTELLIGENCE_ENGINE.md` for the full pipeline.

## Growing the library

1. **Tags** — add to `vibe-keywords-master-tags.ts` or `tagBatch([...], weights, sceneHints)`.
2. **Scenes** — add `SceneEntry` to `scene-library-master.ts` (compound `terms[]` only).
3. **Canonical scenes** — add aliases in `scene-canonicalizer.ts` → inherit from `scene-prototypes.ts`.
4. **Graph** — add `ConceptNode` to `knowledge-graph.ts` with `terms`, `edges: [{ targetId, type, weight }]`.

Prefer long compound phrases over single words for scenes.

## Example prompts (graph + scenes)

```
late summer evening, driving home from seeing old friends, motown warmth
2am petrol station, neon, cinematic, lonely but peaceful
hidden corners of your library, 90s britpop nostalgia
rain on windscreen, heartbroken but healing, slow burn
take me back to 2019, forgotten indie phase
```

## Next batches

Expand `CONCEPT_GRAPH` and `CANONICAL_SCENES` toward 500 scenes; optional JSON import. UI stays text-only.
