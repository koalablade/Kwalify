# Emotion Survival Report

Diagnostic audit for dominant emotional consistency.

Scope: diagnostics only. No emotion, V3, recovery, taxonomy, scoring, or playlist behavior was changed.

## Product Invariant

The product vision is:

- One dominant emotion
- One dominant visual
- One dominant feeling

The new diagnostic framework tests whether a prompt's dominant emotion remains present in the final playlist and where it can drift.

## Runtime Fields

Emotion diagnostics live at:

- `intentSurvival.emotionSurvival`
- `v3Diagnostics.intentSurvival.emotionSurvival`

The payload includes:

- `dominantEmotion`
- `promptEmotions`
- `finalEmotionDistribution`
- `survivalPercent`
- `intensityRetainedPercent`
- `polarityFlipRisk`
- `driftWarnings`
- `stageRisks`

## Tracked Emotions

The framework tracks:

- Melancholy
- Nostalgia
- Tension
- Aggression
- Anticipation
- Loneliness
- Peace
- Euphoria
- Longing
- Wonder

Prompt evidence comes from explicit prompt terms plus `EmotionProfile` signals where available. Final-track evidence is inferred from audio features and metadata only for diagnostics.

## Emotion Drift Points

### Prompt Parsing

Risk: medium.

Emotion can mix when a prompt contains competing signals. Example: `rainy night walk` can produce melancholy, calm, loneliness, and tension together.

### Intent Normalization

Risk: medium.

Mood tags are compressed into buckets such as `melancholic`, `calm`, `nostalgic`, `warm`, and `energised`. Fine-grained feeling can weaken here.

### Unified Intent

Risk: high.

Multiple intent representations are averaged. If emotion profile, scene intent, locked intent, and memory disagree, the dominant emotion can become balanced.

### Retrieval

Risk: high.

Retrieval uses genre, scene, taste, mood, energy, and library signals. It can retrieve tracks that match genre but not the dominant feeling.

### V3 Lanes

Risk: high.

Contrast, motion, and exploration lanes can add alternate emotions. This helps playlists feel alive but can weaken "one dominant feeling".

### Diversity and Cluster Selection

Risk: medium.

Cluster selection can preserve structural variety while mixing emotional quadrants.

### Recovery

Risk: critical.

Recovery is the highest emotional-risk stage because it can widen to broad energy, softened constraints, or best-available fill pools.

### Finalization

Risk: high.

Finalization can relax cohesion, artist limits, album limits, and hard-safe fills. It can keep the playlist valid while weakening subtle emotional consistency.

## Polarity Flip Detection

The diagnostic framework flags likely polarity flips, including:

- `melancholy -> euphoria`
- `peace -> aggression`
- `loneliness -> euphoria`
- `nostalgia -> aggression`

These do not block generation. They appear as evidence for debugging and release triage.

## Example Diagnostic Interpretation

For `melancholy rainy evening jazz`:

- Expected dominant emotion: `melancholy`
- Supporting scene: rain, evening, city/bar atmosphere
- Failure pattern: final distribution dominated by `euphoria` or `aggression`
- Likely source: retrieval broadening, V3 contrast lanes, recovery fill, or finalization relaxed fill

For `industrial techno warehouse rave`:

- Expected dominant emotion: `aggression` or `tension`
- Supporting visual: warehouse, underground, dark motion
- Failure pattern: final distribution dominated by `peace` or generic euphoria
- Likely source: family-level electronic convergence or diversity-driven lane spread

## Release Risk

Emotion is still the most fragile dimension because it is represented across several systems:

- Mood tags
- Energy and valence
- Scene latent vectors
- Emotion profile fields
- V3 lane weights
- Cluster spread
- Finalization safety and fill logic

The new diagnostics make this visible per generation, but they do not yet enforce a hard dominant-emotion invariant.

## Highest ROI Future Fixes

Do not implement as part of this diagnostic pass.

- Add a protected dominant-emotion contract shared by parsing, retrieval, V3, recovery, and finalization.
- Require recovery candidates to preserve dominant emotional polarity unless the system returns a controlled failure.
- Add benchmark thresholds for `emotionSurvival.survivalPercent` and `polarityFlipRisk`.
- Separate scene visual survival from generic mood/audio survival.
