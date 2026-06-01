# Emotional Intelligence Engine (V2)

Deterministic, explainable, layered — not ML black-box.

## Pipeline order

```
User vibe text
    ↓
1. intent-decoder.ts        (escape | reflect | heal | emotional_processing | …)
2. scene-canonicalizer.ts   (many phrases → one sceneId + confidence)
3. scene-prototypes.ts      (structure: emotionFlow, energyCurve, excludes)
4. analyzeVibe (keywords)   ONLY blended when canonical confidence < 0.62
5. knowledge-graph.ts       2-hop typed edge propagation
6. emotional-physics.ts     emotionVector + forces → trajectory
7. scene-sonic-map.ts       tempo / instrumentation / brightness
8. intent override          final profile nudge
9. experience scene         skipped if canonical confidence ≥ 0.65
    ↓
Scoring (liked songs only)
    → temporal-memory.ts
    → negative-tags.ts (excludes)
    → forgotten-favourites / freshness
    ↓
Sequencing + surprise-engine.ts (safe | edge | memory | contrast)
```

## Typed graph edges

| Type | Effect |
|------|--------|
| `amplifies` | Strengthens target emotion weights |
| `softens` | Reduces tension, adds calm |
| `contradicts` | Adds tension + mixed valence |
| `transitions_to` | Sets journey arc toward target |
| `nostalgic_for` | Boosts nostalgia |
| `co_occurs_with` / `often_coexists_with` | Co-occurrence nudge |
| `soundtrack_to` | Strong scene + sonic association |

2-hop example:

`late_summer_friends` → nostalgia (0.8) → indie (hop 2) → warmth

## Canonical scenes

`night_drive_alone_reflection` absorbs:

- late night drive alone
- driving at 2am
- night motorway alone

Prevents duplicate scoring and tag soup.

## API: `emotionalIntelligence`

On `POST /api/generate`:

```json
{
  "emotionalIntelligence": {
    "pipeline": { "intent", "canonicalScene", "emotionTrajectory", "graphHops", … },
    "scene": "petrol_2am_liminal",
    "emotionTrajectory": "nostalgic → reflective → calm",
    "graphHops": ["late_summer_friends -amplifies(1)→ nostalgia", …]
  }
}
```

## Success criteria mapping

| Goal | Mechanism |
|------|-----------|
| 2am ≠ 10am petrol | Separate canonical ids + sonic profiles |
| Journeys not collections | Physics trajectory + narrative roles + arcs |
| Rediscovery | temporal-memory + forgotten-favourites |
| Explainable songs | scoring-explanation + track reasons (extend UI) |
| No tag soup | Canonical confidence gate on keyword layer |

## Files

| Module | Role |
|--------|------|
| `intent-decoder.ts` | Human intent before scoring |
| `scene-canonicalizer.ts` | Scene compression |
| `scene-prototypes.ts` | Structural templates |
| `knowledge-graph.ts` | Typed 2-hop graph |
| `emotional-physics.ts` | Vectors + forces |
| `scene-sonic-map.ts` | Audio characteristics |
| `temporal-memory.ts` | Track lifecycle |
| `negative-tags.ts` | Exclusion penalties |
| `surprise-engine.ts` | Controlled surprise |
| `moment-pipeline.ts` | Orchestrator |
| `scoring-explanation.ts` | Explainability helpers |
