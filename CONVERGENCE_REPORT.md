# Convergence Report

Diagnostic audit for prompt collapse and output overlap.

Scope: diagnostics only. The framework measures convergence risk but does not change candidate retrieval, V3 ranking, sampler behavior, diversity, or recovery.

## Runtime Fields

Convergence diagnostics live at:

- `intentSurvival.convergence`
- `v3Diagnostics.intentSurvival.convergence`

The payload includes:

- `promptSignature`
- `intentSignature`
- `retrievalSignature`
- `candidateSignature`
- `samplerSignature`
- `finalSignature`
- `overlap.retrievalToCandidate`
- `overlap.candidateToSampler`
- `overlap.samplerToFinal`
- `overlap.retrievalToFinal`
- `convergenceRisk`
- `likelyConvergencePoints`

## What Convergence Means

Convergence happens when distinct prompts become similar at a later stage.

Example:

- `industrial techno warehouse rave`
- `hard techno warehouse rave`
- `dark warehouse techno`
- `underground techno bunker`

These prompts should overlap, but not collapse. The system should preserve differences in subgenre, scene, aggression/tension, and underground atmosphere.

## Measured Stages

### Intent Similarity

Measured through normalized prompt and locked intent signatures:

- Genre family
- Primary subgenre
- Mood
- Activity
- Energy
- Era
- Scene/time/place terms

Risk: different prompts can normalize to the same `electronic + high energy + dark/party` signature.

### Retrieval Overlap

Measured from `retrievalPoolsDetailed` top candidates.

Risk: family fallback or broad Spotify search can make distinct prompts share the same retrieval pool.

### Candidate Overlap

Measured from `preV3TopCandidates`.

Risk: contract/ranking stages can flatten prompt differences into a shared high-score pool.

### Sampler Overlap

Measured from `selectionTrace` where available.

Risk: lanes and cluster selection can select similar track archetypes for different prompts.

### Final Playlist Overlap

Measured from final track IDs.

Risk: if retrieval and final overlap are both high, the prompt likely collapsed before finalization.

## Test Groups

Use these benchmark groups for future controlled tests:

### Techno / Warehouse Group

- `industrial techno warehouse rave`
- `hard techno warehouse rave`
- `dark warehouse techno`
- `underground techno bunker`

Expected behavior:

- Meaningful overlap in electronic/techno family.
- Different subgenre and atmosphere signatures.
- `industrial` should retain harder/noisier/tension cues.
- `underground techno bunker` should retain dark/claustrophobic scene cues.

### D&B / Jungle Group

- `liquid d&b focus`
- `rollers night drive`
- `deep atmospheric d&b`
- `jungle nostalgia`

Expected behavior:

- D&B and jungle should be related but not identical.
- Liquid/focus should be smoother and less aggressive.
- Rollers/night drive should preserve motion.
- Jungle nostalgia should preserve older/retro breakbeat identity.

### Jazz / Rain / Night Group

- `melancholy rainy evening jazz`
- `late-night jazz bar`
- `city rain jazz`
- `lonely midnight jazz`

Expected behavior:

- Jazz family overlap is acceptable.
- Melancholy/lonely/rain/night/bar/city should remain distinguishable.
- Emotional polarity should not flip into bright or social jazz unless requested.

## High-Risk Convergence Points

Critical:

- Global expansion after retrieval starvation.
- Recovery paths that ignore narrow scene/emotion identity.
- No-library broad fallback queries such as popular family-level terms.

High:

- Subgenre-to-family fallback.
- Adjacent-family expansion.
- V3 relaxed candidate profile selection.
- Diversity lanes adding similar contrast/exploration tracks across prompts.

Medium:

- Unified intent averaging.
- Cluster selection using coarse genre/mood/energy buckets.
- Artist penalties reducing narrow-scene artist consistency.

Low:

- Strict intent path with no fallback, strong subgenre evidence, and high final survival scores.

## How To Use The Diagnostic

Run controlled prompt groups and compare:

- `intentSignature`: did parsing preserve differences?
- `retrievalSignature`: did retrieval collapse first?
- `candidateSignature`: did pre-V3 candidate selection collapse?
- `samplerSignature`: did V3 lanes collapse outputs?
- `finalSignature`: did finalization/recovery collapse outputs?
- `overlap`: where did track ID overlap spike?

If intent signatures differ but retrieval overlap is high, fix retrieval later.

If retrieval signatures differ but candidate/sampler overlap is high, fix V3 candidate/ranking diagnostics later.

If sampler differs but final playlist overlap is high, inspect recovery and finalization.
