# Intent Survival Report

Diagnostic report for the universal intent-survival tracing framework.

Scope: diagnostics only. This report describes the new runtime trace produced by `buildIntentSurvivalDiagnostics()` in `backend/lib/intent-survival-diagnostics.ts`. It does not change V3 scoring, ranking, retrieval, recovery, taxonomy, or playlist generation behavior.

## Runtime Output

Each successful generation now includes:

- `intentSurvival`
- `v3Diagnostics.intentSurvival`
- `generationAuditSnapshot.intentSurvival`
- `debug.intentSurvival` when debug mode is active

The diagnostic payload answers: how much of the original prompt survived each stage, which dimensions weakened, which stages introduced drift risk, and which relaxations or recovery paths were activated.

## Tracked Dimensions

The framework scores these dimensions independently:

- Genre
- Subgenre
- Mood
- Scene
- Activity
- Era
- Energy
- Emotion
- Place
- Time
- Atmosphere

Each dimension includes:

- `score`: 0-100 survival percentage
- `explicit`: whether the prompt made this dimension explicit
- `matchedCount`: final tracks that support the dimension
- `totalCount`: final track count
- `evidence`: expected values and matching basis

Inactive dimensions return `100` with `inactiveReason: "dimension_not_explicit"` so overall scoring is not punished for dimensions the user did not request.

## Automated Survival Score

The diagnostic payload produces:

```json
{
  "genreSurvival": 98,
  "subgenreSurvival": 91,
  "moodSurvival": 84,
  "sceneSurvival": 80,
  "activitySurvival": 88,
  "eraSurvival": 100,
  "energySurvival": 86,
  "emotionSurvival": 78,
  "placeSurvival": 75,
  "timeSurvival": 82,
  "atmosphereSurvival": 79,
  "overallIntentSurvival": 86
}
```

Overall score is weighted toward the dimensions most likely to be user-visible:

- Emotion, subgenre, genre, era, scene, and mood carry the highest weight.
- Energy, place, time, and atmosphere support the score but do not dominate it.

## Full Pipeline Trace

The framework records a 28-stage trace:

1. Prompt
2. Prompt parsing
3. Intent normalization
4. Intent contract
5. Locked intent
6. Unified intent
7. Retrieval query generation
8. Spotify search
9. Library retrieval
10. Retrieval ranking
11. Retrieval fallback ladders
12. Family expansion
13. Adjacent-family expansion
14. Global expansion
15. Candidate pool construction
16. Candidate filtering
17. Scoring inputs
18. V3 ranking
19. V3 sampler
20. Diversity systems
21. Artist penalties
22. Cluster selection
23. Contract-fit scoring
24. Coherence scoring
25. Recovery ranking
26. Recovery fallback
27. Finalization
28. Final playlist

For each stage the trace records:

- `inputIntent`
- `outputIntent`
- `preservedDimensions`
- `weakenedDimensions`
- `lostDimensions`
- `newlyIntroducedDimensions`
- `potentialDriftVectors`
- `evidence`

## Stage-By-Stage Survival Logging

The `stageByStageLog` field gives compact debugging summaries suitable for benchmark output:

```json
[
  {
    "stage": "retrieval_ranking",
    "summary": "retrieval_ranking risk: subgenre, mood, scene",
    "counts": {
      "preserved": 11,
      "weakened": 1,
      "lost": 0,
      "driftVectors": 3
    },
    "survivalPercent": 76
  }
]
```

This is diagnostic-only. It does not feed back into ranking, filtering, recovery, or finalization.

## Highest-Risk Survival Points

Critical risk:

- Recovery path activation can weaken mood, activity, energy, emotion, and scene.
- Global retrieval expansion can sacrifice subgenre, scene, mood, and emotion.
- Strict genre evidence relaxation can return "best available" tracks when evidence is insufficient.

High risk:

- Subgenre-to-family fallback preserves genre family but weakens identity.
- V3 relaxed candidate profiles can drop era, genre, audio, or mood strictness.
- Finalization relaxed fills can prioritize completion and safety over nuanced atmosphere.
- No-library broad search can introduce family-level or popular-track drift.

Medium risk:

- Unified intent averaging can reduce intensity of a dominant prompt emotion.
- Diversity and artist penalties can improve variety while weakening a narrow subgenre identity.
- Cluster selection operates on coarse mood/energy/genre groupings.

Low risk:

- Explicit prompt dimensions with strong evidence and no fallback path generally survive through finalization.

## Release Interpretation

Use `releaseReadiness` in the payload for a per-playlist answer:

- `canPreserveGenre`
- `canPreserveSubgenre`
- `canPreserveMood`
- `canPreserveScene`
- `canPreserveActivity`
- `canPreserveEra`
- `canPreserveEmotion`
- `highestRisk`
- `highestRiskReasons`

The system is release-ready for a prompt only when explicit dimensions remain above their thresholds and no critical leak path was activated.
