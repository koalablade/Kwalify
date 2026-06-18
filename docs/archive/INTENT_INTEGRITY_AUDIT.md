# Intent Integrity Audit

Forensic audit of how a prompt survives Kwalify's playlist generation pipeline.

Scope: prompt parsing through final playlist output. No fixes implemented in this report.

## Executive Summary

The system has strong intent machinery, but it is split across several parallel representations:

- `EmotionProfile` from `backend/lib/emotion.ts`
- human intent from `backend/lib/intent-decoder.ts`
- `LockedIntent` and `SceneIntent` from `backend/core/v3/intent.ts`
- `IntentContract` inside `backend/core/playlist-pipeline.ts`
- `ConstraintLayer` inside `backend/controllers/generation.controller.ts`
- `UnifiedIntent` from `backend/core/unified-intent.ts`
- V3 `DecomposedIntent` from `backend/core/v3/intent-decomposer.ts`
- V3 lane, cluster, sampler, diversity, and finalization diagnostics

The core integrity risk is not that intent is absent. The risk is that different stages enforce different versions of intent. Some stages treat genre/era as hard constraints, some treat them as scoring features, some normalize them into broad families, and recovery can remove activity, mood, energy, genre, era, or cohesion pressure depending on fill pressure.

Highest-risk locations:

- Retrieval starvation expansion in `buildPlaylistPipeline()` can widen contract/subgenre pools to family, adjacent family, then global.
- V3 relaxation in `buildV3CandidatePool()` can drop era, then genre, then audio, then mood.
- `retrieveCandidatesByEmbedding()` blends intent with library centroid and session/memory vectors, which can pull output toward user history.
- V3 lanes intentionally add contrast/exploration lanes, which can preserve variety while weakening dominant prompt identity.
- `finalizePlaylistTracks()` can relax cohesion, artist limits, album limits, and hard-safe fill rules to avoid underfilled playlists.
- `recoverLowComplexityPlaylist()` can remove activity, mood, energy, and constraints in recovery.
- Controller evidence guards can relax to "best available" genre or compatible/unknown era if enough tracks remain.

The most important missing invariant is a single, explicit "dominant intent contract" that every stage must respect unless the system returns a controlled failure. Emotional state is especially vulnerable because it is represented as vectors, forces, moods, audio features, scene labels, and lane weights rather than one protected dominant emotional state.

## Full Pipeline Map

### 1. Prompt Input

Input intent:

- Raw user text such as `industrial techno warehouse rave`, `d&b rollers for night driving`, `melancholy rainy evening jazz`, `90s boom bap for studying`, or `walking through tokyo at 3am`.

Preserved:

- Raw text is passed into controller parsing, scoring, V3 pipeline, no-library search, prompt keys, diagnostics, and finalization.

Weakened/lost:

- Raw text is not treated as the final authority after parsing. Later systems rely on parsed abstractions, not the full phrase.

Drift risk:

- Rare compound meanings can split apart. Example: `industrial techno warehouse rave` can become electronic + high energy + party + urban, losing "industrial warehouse" specificity.

### 2. Prompt Parsing

Primary locations:

- `analyzeEmotion()` in `backend/lib/emotion.ts`
- `decodeIntent()` in `backend/lib/intent-decoder.ts`
- `buildLockedIntent()` in `backend/core/v3/intent.ts`
- controller constraint parsing in `backend/controllers/generation.controller.ts`
- `parseUserIntent()` via V3 decomposition

Preserved:

- Genre aliases, era terms, mood terms, activity terms, time/place hints, energy words, and scene tokens.
- Explicit era text like `90s` is recognized.
- Common activities like driving, focus, gym, walking, party are recognized.

Weakened:

- Multiple parsers can disagree. One parser can read `rave` as party/high energy while another reads `techno` as electronic and another reads `warehouse` as urban scene.
- `analyzeEmotion()` applies additive keyword weights, so competing terms can average each other.
- `intent-decoder.ts` has a small rule set and only outputs broad human intent such as `focus`, `energise`, `reflect`, `neutral`.

Lost:

- Some location-specific scenes are not first-class. `Tokyo at 3am` is mostly city/night/walking unless a specific Tokyo scene exists elsewhere.
- Subgenre identity depends on taxonomy coverage. If `rollers`, `liquid d&b`, `boom bap`, or `industrial techno` are not detected as structured subgenre terms, they can collapse to family.

Added:

- Implied energy and emotion from scene words. Rain increases calm and tension. Late night increases nostalgia/tension and lowers energy. Urban can increase energy/tension.

Drift introduced:

- Emotional drift: rain/night can add tension even when user expected peaceful sadness.
- Activity drift: `rave` can pull toward party even when the intended prompt is subgenre identity.
- Scene drift: `warehouse` can become generic urban or party rather than industrial/underground.

### 3. Intent Normalization

Primary locations:

- `parseGenreFamilies()`, `parseSubgenreIntent()`, `parseEra()`, `parseEnergy()`, `applyInterpretationBudget()` in `backend/core/v3/intent.ts`
- `expanded-intent-vocabulary.ts`
- `genre-taxonomy-data.ts`

Preserved:

- Canonical genre families and subgenre labels.
- Era ranges as `{ start, end }`.
- Energy normalized to low/medium/high.

Weakened:

- Families flatten specificity. `industrial techno`, `hard techno`, `trance`, `jungle`, and `d&b` all eventually share the electronic family.
- `applyInterpretationBudget()` can drop dimensions when a prompt is considered low/medium complexity.
- Subgenre ranking chooses primary and secondary subgenre; tertiary nuance is truncated.

Lost:

- Textual ordering and emphasis. `industrial techno warehouse rave` and `warehouse industrial techno` are mostly equivalent after normalization.
- Fine emotional adjectives that are not mapped into mood buckets.

Added:

- Fallback moods from profile, fallback energy from profile, genre-family inference from broad terms.

Drift introduced:

- Subgenre drift when primary subgenre evidence is weak and the system falls back to family.
- Convergence when multiple techno-adjacent prompts all normalize to `electronic` + `techno` + high energy.

### 4. Intent Contracts

Primary locations:

- `IntentContract` type and `parseIntentContract()` in `backend/core/playlist-pipeline.ts`
- `intentContractFit()`
- `enforceIntentContract()`
- `constrainPoolToIntentContract()`

Preserved:

- Genres, primary genre, subgenres, era, mood, activity, energy, time of day, place, identity terms, explicit dimensions.
- Required pass for genre and era in `intentContractFit()`.

Weakened:

- Contract fit is a ratio. Non-required dimensions can fail while a track still passes.
- `constrainPoolToIntentContract()` accepts score >= 0.50, then relaxes to >= 0.34 if strict has no results.
- Required dimensions are mostly genre and era; mood/activity can be soft.

Lost:

- Dominant emotional state is not required as a protected field.
- Scene is spread across time/place/activity/mood and not one hard scene contract.

Added:

- Identity terms extracted from raw text, genre aliases, mood/activity/place/time terms.

Drift introduced:

- Mood drift if genre/era pass but mood fails.
- Activity drift if activity is present but contract score remains acceptable.
- Scene drift when time/place terms are present but not required.

### 5. Locked Intent

Primary locations:

- `LockedIntent` in `backend/core/v3/intent.ts`
- `completeLockedIntent()`
- `buildV3LockedIntent()` in `backend/core/playlist-pipeline.ts`

Preserved:

- Genre families, primary genre, primary/secondary subgenre, subgenre terms, era range, mood, activity, energy, scene intent.

Weakened:

- `completeLockedIntent()` can fill missing values from emotion profile, which may blur explicit text with inferred state.
- `buildV3LockedIntent()` uses explicit prompt genre families if available, but otherwise keeps fallback/inferred values.

Lost:

- Raw phrase-level identity is not stored as a mandatory invariant.
- Dominant emotional state is not stored as a single required value.

Added:

- Inferred energy from emotion profile when missing.
- Scene intent from latent vector logic.

Drift introduced:

- Emotion drift through inferred energy.
- Scene drift through latent vector recentering and prototype blending.

### 6. Unified Intent

Primary locations:

- `buildUnifiedIntentContext()`
- `resolveUnifiedIntent()`
- `unifiedIntentFromControllerIntent()`
- `unifiedIntentFromV11Intent()`
- `unifiedIntentFromLockedIntent()`
- `unifiedIntentFromSceneIntent()`
- `injectMomentContext()`

Preserved:

- Controller/human intent, V11 intent, locked intent, and scene intent are converted into comparable vectors.

Weakened:

- `resolveUnifiedIntent()` averages snapshots. Disagreement becomes a blended vector unless later code reacts to disagreement.
- `injectMomentContext()` can blend previous moment memory into current prompt.
- Vector normalization can reduce intensity differences.

Lost:

- Exact subgenre and exact scene wording are not first-class in the final unified vectors.

Added:

- Moment memory and previous session context.
- Latent ambiguity, introspection, motion, isolation, memory activation.

Drift introduced:

- Emotional drift through averaging. A prompt with one dominant emotion can become balanced if snapshots disagree.
- Convergence through global priors and memory vectors.

### 7. Retrieval Query Generation

Primary locations:

- `buildRetrievalPools()` in `backend/core/playlist-pipeline.ts`
- `noLibrarySearchQueries()` in `backend/controllers/generation.controller.ts`
- `retrieveCandidatesByEmbedding()` in `backend/core/v3/embedding-retrieval.ts`

Preserved:

- Contract genres/subgenres in library retrieval.
- No-library queries include cleaned prompt, subgenre terms, controlled aliases, genre terms, and era-prefixed terms.

Weakened:

- Library retrieval is based on already-scored tracks, not direct raw Spotify search.
- No-library queries can include broad family terms like `popular electronic` or `popular music` in fallback.
- Embedding retrieval uses scene, taste, mood, energy, and drift components, not only prompt identity.

Lost:

- Fine-grained subgenre can be lost when query fallback removes `subgenreTerms`.

Added:

- Controlled aliases for techno/d&b/jungle.
- Popular/family/global fallback search queries.
- User taste centroid, mood trajectory, and scene preference vectors.

Drift introduced:

- Genre drift through family search and broad search.
- Emotional drift through taste/memory vectors.
- Scene drift when embedding affinity is close but scene terms are absent.

### 8. Spotify Search

Primary locations:

- `buildNoLibrarySpotifyCandidates()`
- `searchSpotifyTracks()`
- `timeboxRetrievalSource()`

Preserved:

- Initial query list can include exact prompt and subgenre aliases.

Weakened:

- Best-effort search returns partial results under timeboxes.
- If strict search returns zero, it tries family search without subgenre terms.
- If still zero, it tries broad family and `popular music`.

Lost:

- Subgenre identity can be lost at the family search fallback.
- Genre identity can be lost at `popular music`.

Added:

- Popularity bias from Spotify search.
- Metadata enrichment may add artist/album genres and release years, but can be partial.

Drift introduced:

- Public/no-library mode can be more exposed to query drift than synced-library mode.
- Timeout of artist genre, album metadata, or audio features leaves downstream guards with weaker evidence.

### 9. Library Retrieval

Primary locations:

- `runScoringPipeline()`
- `buildRetrievalPools()`
- `genreFamilyForTrack()`
- `classifyTrack()`

Preserved:

- Tracks are scored against vibe, emotion profile, genre intelligence, memory, novelty, and profile.

Weakened:

- User library composition strongly controls what can be retrieved.
- Genre family inference may use audio heuristics or broad metadata when explicit taxonomy evidence is weak.

Lost:

- If the user's library lacks enough exact subgenre, retrieval has to fall back to family/adjacent/global.

Added:

- Library affinity and user taste bias.
- Freshness and rediscovery signals.

Drift introduced:

- Genre and emotional convergence toward the user's most common library clusters.
- Era drift if release years are missing and lane era is estimated from audio.

### 10. No-Library Mode

Primary locations:

- no-library request validation in controller
- `buildNoLibrarySpotifyCandidates()`
- final genre evidence checks

Preserved:

- Requires a clear genre prompt; rejects mood-only no-library prompts.

Weakened:

- Search fallback can broaden from subgenre to family to popular music.
- Metadata fetch timeboxes can produce partial candidate evidence.

Lost:

- Subgenre and era can be unavailable if Spotify metadata is incomplete.

Added:

- Spotify-wide candidates outside user library.

Drift introduced:

- Public-facing broad-search drift.
- Metadata-unknown tracks can survive if downstream stages treat unknowns as compatible.

### 11. Retrieval Ranking

Primary locations:

- `buildRetrievalPools()`
- `earlyDiversityRank()`
- `promptOrderingBias()`
- `identityTermScore()`

Preserved:

- Contract fit, subgenre match weight, identity terms, mood/activity/energy lifts.

Weakened:

- Diversity and artist penalties can reorder otherwise stronger intent matches.
- Prompt hash adds deterministic variety that is not semantically meaningful.

Lost:

- Exact prompt identity can be outranked by freshness/diversity if the score gap is small.

Added:

- Early artist/family spacing.
- Feedback penalties and recent track penalties.

Drift introduced:

- Artist diversity can reduce repeated exact-fit artists and pull in weaker-fit alternatives.
- Family spacing can weaken broad prompts without explicit genre.

### 12. Retrieval Fallback Ladders

Primary locations:

- `buildRetrievalPools()`
- `buildPlaylistPipeline()` pre-ranking expansion
- `buildV3CandidatePool()`
- `RETRIEVAL_RELAXATION_LADDER`

Relaxation ladder observed:

- Contract/subgenre-safe pool
- Same family expansion
- Adjacent family expansion
- Global expansion
- V3 strict
- V3 semi-relaxed
- V3 embedding-first
- V3 fallback-explore

Preserved:

- Some scoring and final safety remains after widening.

Weakened:

- Each step sacrifices a dimension:
  - Family expansion sacrifices subgenre.
  - Adjacent expansion sacrifices genre family.
  - Global expansion sacrifices genre family and scene identity.
  - Embedding-first sacrifices structured constraints in favor of vector closeness.
  - Fallback-explore accepts basic identity only.

Lost:

- Exact subgenre can be lost first.
- Mood/activity/scene can be lost later.

Drift introduced:

- High risk of genre, subgenre, mood, and emotional drift under starvation.

### 13. Retrieval Expansion

Primary locations:

- `retrievalExpandedDueToStarvation`
- `fallbackExpansionPath`
- `retrievalSafetyExpanded`
- `layeredSafetyPool`

Preserved:

- Uses layered pools with core, anchor, adjacent, bridge, energyArc, discovery.

Weakened:

- Once `retrievalSafetyExpanded` is true, V3 input can use `layeredSafetyPool` rather than the stricter guarded pool.
- Safety expansion is designed for completion and latency, not maximum fidelity.

Lost:

- The strict candidate set stops being the only V3 input source.

Added:

- Broad candidates to prevent empty outputs and timeouts.

Drift introduced:

- Candidate pool convergence and emotional dilution.

### 14. Family Expansion

Primary locations:

- `sameFamilyExpansion`
- `trackMatchesGenreFamilies()`
- `structuredRetrievalScope()`

Preserved:

- Root family remains intact.

Weakened:

- `industrial techno`, `hard techno`, `trance`, `d&b`, and `jungle` all share electronic family.
- `boom bap`, trap, drill, and generic rap all share hip-hop family.

Lost:

- Microstyle identity can be lost.

Drift introduced:

- Subgenre drift and convergence across related prompts.

### 15. Adjacent-Family Expansion

Primary locations:

- `adjacentGenreFamilies()`
- `bridgeFamiliesForTrack()`

Preserved:

- Some musical adjacency.

Weakened:

- Family boundary becomes advisory.

Lost:

- Explicit genre integrity can be diluted when adjacent tracks are scored high.

Added:

- Cross-family bridge tracks.

Drift introduced:

- Genre drift and scene drift, especially for broad mood/activity prompts.

### 16. Global Expansion

Primary locations:

- `globalExpansion = scoring.sorted`
- `fatal_global`
- `fallback_explore`

Preserved:

- Only global scoring and final guards remain.

Weakened:

- Contract identity is no longer the source pool boundary.

Lost:

- Genre/subgenre/scene/mood can all be lost if final guards are not strict for that prompt.

Added:

- Full scored library backstop.

Drift introduced:

- Highest convergence risk.

### 17. Candidate Pool Construction

Primary locations:

- `buildV3CandidatePool()`
- `uncollapseV11CandidatePool()`
- `capV3SafetyPool()`

Preserved:

- Candidate pools are filtered for metadata readiness and locked intent where possible.

Weakened:

- Relaxation plan can select a non-strict candidate set if strict count is below minimum.
- `uncollapseV11CandidatePool()` intentionally expands for family spread.
- V3 safety input cap can truncate to top scored tracks, which can favor broad scoring over exact identity.

Lost:

- Tracks removed for missing metadata may include good intent matches.
- Exact subgenre can be lost when the pool is expanded for diversity/family spread.

Drift introduced:

- Metadata availability bias.
- Family spread overriding dominant identity.

### 18. Candidate Filtering

Primary locations:

- `trackMatchesConstraints()`
- `trackMatchesLockedIntent()`
- `trackMatchesHardConstraints()`
- `trackPassesLockedIntent()`
- `finalTrackIsSafe()`
- `finalTrackIsHardSafe()`

Preserved:

- Explicit genre, era, activity, mood, energy, and prompt-specific final guards can reject unsuitable tracks.

Weakened:

- Some filters allow unknown metadata.
- `trackPassesLockedIntent()` accepts mood OR activity match when mood/activity intent exists.
- `finalTrackIsHardSafe()` skips some softer locked-intent checks and relies on hard constraints/prompt guards.

Lost:

- Emotional integrity is not a universal hard filter.

Drift introduced:

- Mood and activity drift when one of the two passes but the other fails.
- Era drift where unknown era is considered compatible in some places.

### 19. Scoring Inputs

Primary locations:

- `runScoringPipeline()`
- `scoreLane()`
- `runRecommendationEngine()`
- `attachHierarchicalAffinities()`

Preserved:

- Emotion profile, scene affinity, taste affinity, freshness, embedding affinity, locked intent, unified intent.

Weakened:

- Scoring combines many terms. A strong genre match can offset mood mismatch; freshness can alter ordering; taste can pull toward prior habits.
- `attachHierarchicalAffinities()` averages existing score and lane taste.

Lost:

- A single dominant emotion is not protected from tradeoffs.

Added:

- Recommendation engine memory and diversity signals.
- Session artist penalties and track reuse penalties.

Drift introduced:

- Emotional drift through scoring tradeoffs.
- Genre drift through taste/freshness if constraints are relaxed.

### 20. V3 Candidate Ranking

Primary locations:

- `scoreLane()` in `backend/core/v3/lane-scorer.ts`

Preserved:

- Lane influence affinity, emotion match, era match, activity match, genre bonus.

Weakened:

- Lane scoring is weighted, not constraint-first.
- Generic force-to-genre mappings can be too broad:
  - `driving` maps to rock/country/indie/americana.
  - `night` maps to indie/alternative/jazz/electronic.
  - `party` maps to pop/electronic/hip-hop/rnb.
  - `energy` maps to rock/electronic/hip-hop/pop.

Lost:

- Specific scenes can become generic forces.

Added:

- Contrast, novelty, lane-specific era bonuses, acoustic bonuses.

Drift introduced:

- Scene drift: `warehouse` can become party/urban.
- Activity drift: `night driving` can become generic driving rock/indie unless constrained.

### 21. V3 Sampler

Primary locations:

- `selectFromClusters()` in `backend/core/v3/v3-sampler.ts`

Preserved:

- Input is assumed already valid.
- Genre and era caps are disabled when locked intent has genre/era.

Weakened:

- Sampler optimizes distribution, sequence safety, cluster caps, and neighborhood diversity.
- Energy curve target can favor structural flow over static mood fidelity.

Lost:

- Sampler does not re-check the raw prompt.

Added:

- Cluster-based selection, softmax randomness, neighborhood weighting, sequence rules.

Drift introduced:

- Emotional drift through energy-band rotation.
- Scene drift through neighborhood selection.
- If input pool was relaxed, sampler can confidently select relaxed-but-not-perfect tracks.

### 22. Diversity Systems

Primary locations:

- `global-diversity-controller.ts`
- `diversity-pressure.ts`
- `buildRecentTrackPoolPenalty()`
- session artist memory

Preserved:

- Reduces repetition and artist collapse.

Weakened:

- Diversity pressure can penalize exact-fit repeated artists/tracks.
- For broad prompts, genre/family caps can intentionally diversify away from the dominant cluster.

Lost:

- Repeated exact-fit subgenre specialists may be limited.

Added:

- Freshness, novelty, recent-track avoidance, artist memory penalties.

Drift introduced:

- Genre and subgenre drift when exact-fit pool is small.
- Emotional drift when diversity selects lower-fit emotional alternatives.

### 23. Cluster Selection

Primary locations:

- `buildClusters()`
- `curateClusterCoherentFinalPool()` in controller

Preserved:

- Clusters by genre, era, energy, mood.
- Controller cluster curation can focus final pool around a selected cluster.

Weakened:

- Clustering uses coarse mood quadrants and broad genre/era buckets.
- Cluster curation allows reserves/outliers.

Lost:

- Subgenre and precise emotion are not cluster dimensions.

Added:

- Cohesion pressure after V3.

Drift introduced:

- Convergence because many prompts share identical coarse cluster IDs.

### 24. Contract Fit Scoring

Primary locations:

- `intentContractFit()`
- `contractFitScore`
- `evaluatePlaylistQuality()`

Preserved:

- Genre, era, energy, mood, activity, time, place.

Weakened:

- Fit scoring can be partial.
- Mood/activity are not universally required.

Lost:

- Dominant emotional state and scene-specific nouns are not independent required checks.

Drift introduced:

- Tracks can be "good enough" overall while violating the user's main subjective intent.

### 25. Coherence Scoring

Primary locations:

- `intentCoherenceScore()`
- `preferredCohesionFamilies()`
- `candidateFinalizationScore()`

Preserved:

- Identity terms, expected families, subgenres, era, mood, activity, prompt-specific safety guards.

Weakened:

- Coherence is a score until final gates reject a track.
- Preferred families are inferred from candidates, so a drifted candidate pool can define its own cohesion.

Lost:

- If the dominant pool is already wrong, cohesion can stabilize the wrong direction.

Drift introduced:

- Convergence and self-reinforcing wrong clusters.

### 26. Recovery

Primary locations:

- `recoverLowComplexityPlaylist()`
- `applyLowComplexityRecovery()`
- `broadEnergyRecoveryScore()`

Preserved:

- Finalization still applies safety checks and some identity scoring.

Weakened:

- Recovery can try `activity_relaxed` by setting `activity: null`.
- Recovery can try `mood_relaxed` by setting `activity: null` and `mood: []`.
- `energy_recovery` can set `activity`, `mood`, `energy`, and `energyLevel` to null unless activity recovery is active.
- Activity recovery can use `activityRelaxedConstraints` that clears hard genres, era, strict lock, and explicit terms for broad unconstrained prompts.

Lost:

- Activity, mood, energy, genre, era, and strict terms can be removed in recovery.

Added:

- Broad energy candidate ranking from full library.

Drift introduced:

- Critical recovery drift. Tracks can enter through recovery that would not have survived the main strict pipeline.

### 27. Recovery Ranking

Primary locations:

- `broadEnergyRecoveryScore()`
- `intentCoherenceScore()` reused with recovery identity terms

Preserved:

- Energy and valence are matched to high/low/melancholic broad targets.

Weakened:

- Genre/subgenre/scene are secondary unless final guards catch them.

Lost:

- Fine-grained emotional state is flattened to target energy and target valence.

Drift introduced:

- Emotional drift from melancholy/peaceful/tension/longing into generic low/medium/high energy.

### 28. Recovery Fallback

Primary locations:

- `finalizePlaylistTracks()`
- hard-safe fill phases

Preserved:

- `finalTrackIsHardSafe()` still rejects hard constraint violations and prompt-specific safety guards.

Weakened:

- Repeat signature can be disabled.
- Artist/album caps can be relaxed or removed.
- Cohesion can be disabled for fill.

Lost:

- Artist/album diversity and family cohesion can be sacrificed.

Drift introduced:

- Coherence drift, especially for underfilled playlists.

### 29. Finalization

Primary locations:

- `finalizePlaylistTracks()`
- `validateLockedIntentOutput()`
- strict genre/era evidence guards

Preserved:

- Final safety, malformed/duplicate removal, genre evidence, era evidence, mood/activity validation, prompt-specific hard guards.

Weakened:

- Completion pressure can relax cohesion.
- Strict genre evidence can relax to best available if final count is high enough.
- Strict era evidence can relax to compatible unknowns if verified count is zero but enough compatible tracks remain.
- Hard validation can relax if enough best-available tracks remain.

Lost:

- Exact prompt intent can be subordinated to "publish a non-empty playlist."

Added:

- Final diagnostics and public drift audit.

Drift introduced:

- Final stage can either fix drift or legitimize it as best available.

### 30. Final Playlist Output

Preserved:

- Tracks are sanitized, de-duped, and passed through final guards.
- Diagnostics include many hints about relaxation and drift.

Weakened:

- The UI receives final tracks, not an explicit "intent survival score" that can decide whether to block publication.

Lost:

- User sees bad playlist quality as normal output unless guards block.

Drift introduced:

- Public confidence risk if recovery/finalization publishes "best available" playlists without clear user messaging.

## Dimension Audits

### A. Genre Integrity

Does industrial techno remain industrial techno?

- Strong if `parseSubgenreIntent()` identifies `industrial_techno` or related techno terms and enough contract-safe candidates exist.
- Weakens when subgenre evidence is below threshold and retrieval falls back to family.
- High convergence risk with `hard techno warehouse rave`, `dark warehouse techno`, and `underground techno bunker` because they share electronic family, techno-compatible terms, high energy, dark/urban/party/rave forces.

Does boom bap remain boom bap?

- Strong if taxonomy catches `boom bap` and enough hip-hop subgenre evidence exists.
- Weakens to hip-hop family if subgenre pool is small.
- Can drift to rap/trap/drill if family expansion dominates.

Does liquid d&b remain liquid d&b?

- Strong only if `liquid d&b` or `liquid drum and bass` aliases are detected and search/library has enough evidence.
- Weakens to d&b, jungle, then electronic family.
- No-library controlled aliases help retrieval but can broaden to generic drum and bass or jungle.

Primary genre leak points:

- `parseGenreFamilies()` root family flattening.
- `structuredRetrievalScope()` fallback to family.
- `sameFamilyExpansion`, `adjacentExpansion`, `globalExpansion`.
- V3 `semi_relaxed`, `embedding_first`, `fallback_explore`.
- Lane `INFLUENCE_GENRES` broad mappings.
- Recovery and final evidence relaxations.

### B. Mood Integrity

Can dark become uplifting?

- Yes, if dark is one force among party/energy/euphoric or if lane/contrast/freshness favors high-valence tracks.
- `sceneInfluenceMap` keeps only top 3 forces, so secondary dark cues can be truncated.

Can melancholy become hopeful?

- Yes, if the prompt contains both sadness and hope/warmth, or if emotional split lanes include opposing forces.
- `GENRE_FORCE_INJECTIONS` can add warmth/calm/energy forces from genre alone.

Can chill become energetic?

- Yes, historically through broad electronic/party/rave/driving mappings, energy arcs, and sampler energy band rotation.
- Recent final guards reduce this, but the systemic risk remains upstream because chill is still a scoring dimension in many places, not always hard.

Primary mood leak points:

- Additive emotion keyword weights.
- Influence force top-3 truncation.
- `trackPassesLockedIntent()` mood OR activity logic.
- Lane scoring tradeoffs.
- V3 energy-band and mood-quadrant clusters.
- Recovery dropping mood.

### C. Scene Integrity

Can warehouse become festival?

- Yes. `rave` maps to party/energy/electronic. `warehouse` is mostly urban/industrial context unless protected by a specific scene contract.

Can rainy city become beach vibes?

- Less likely if rainy/city are detected, but possible through broad mood/place prompts, user library bias, or recovery if scene is not hard constrained.

Can night driving become gym music?

- Possible when driving + energy/rhythm overlap and recovery/fill pressures select high-energy tracks. Prompt-specific night-driving guards reduce this at finalization, but V3 lanes can still score motion/energy candidates.

Primary scene leak points:

- Scene terms become environment/time/motion rather than a hard scene identity.
- `UnifiedIntent` averages scene snapshots.
- Embedding retrieval blends scene with taste centroid.
- V3 lane `INFLUENCE_GENRES` maps scenes to broad genre families.
- Cluster curation uses coarse clusters, not scene labels.

### D. Activity Integrity

Can focus become party?

- Yes if `focus` is dropped/relaxed, if genre forces add energy/party, or if recovery removes activity.

Can gym become chill?

- Less likely because gym/workout has hard safety guards, but recovery and broad scoring can still include lower-energy tracks if completion pressure is high.

Can driving become study?

- Possible for night/introspective driving because focus/introspection/calm lanes overlap with driving scene.

Primary activity leak points:

- Activity is a soft contract dimension in several stages.
- `trackPassesLockedIntent()` allows mood OR activity match.
- `recoverLowComplexityPlaylist()` can remove activity.
- Lane routing can split motion from emotional lanes.

### E. Era Integrity

Can 90s become 2010s?

- Yes when releaseYear is missing and unknown-era tracks are treated as compatible.
- Recent final track gate now requires explicit era evidence, but controller evidence relaxation can still publish compatible unknowns under some conditions.

Can 70s become modern?

- Yes through unknown metadata, audio-estimated era, or evidence relaxation.

Primary era leak points:

- `trackEraMatches()` allows unknown era if strict lock is false.
- `eraAllowedWithDrift()` permits tracks without known mismatch.
- `strictEraEvidenceDiagnostics` can relax to compatible unknowns.
- V3 `estimateEraFromAudio()` can infer era from sound rather than release year.
- Recovery can clear era constraints for some activity/broad paths.

### F. Emotional Integrity

Most important finding: there is no single protected dominant emotional state.

The system uses these emotional representations:

- `EmotionProfile`: energy, valence, tension, nostalgia, calm.
- `IntentDecodeResult`: broad human intent such as reflect/energise/focus.
- `LockedIntent.mood`: string buckets like calm, melancholic, nostalgic, energised.
- `SceneIntent.emotionVector`: nostalgia, restlessness, joy, tension, calm.
- `SceneLatentVector`: energy, valence, nostalgia, tension, motion, introspection, warmth, darkness, socialness, clarity.
- V3 `SceneInfluenceMap`: top forces such as melancholy, night, driving, calm, party.
- V3 clusters: mood quadrant from energy/valence only.
- Final safety: prompt-specific guards and coarse mood evidence.

Where emotional consistency is lost:

- Emotion profile averages keyword weights.
- Scene vector is recentered toward prototypes and global prior.
- Unified intent averages controller/V11/locked/scene snapshots.
- Influence map keeps only top three forces.
- Lane generator intentionally creates contrast/exploration lanes.
- Scoring trades emotional match against genre, era, activity, novelty, taste, freshness, diversity.
- Cluster mood is only energy/valence quadrant; it does not know longing, anticipation, peacefulness, aggression, tension, or nostalgia.
- Recovery reduces emotion to broad energy/valence targets.
- Final validation only requires 65% mood evidence when mood is present, and mood evidence is coarse.

Dominant emotional states at risk:

- Nostalgia can become generic older/familiar music.
- Euphoria can become generic high energy.
- Aggression can become generic energy/party.
- Melancholy can become low valence but too angry or too tense.
- Anticipation can become motion/energy.
- Longing can become generic sadness.
- Peacefulness can become low energy but not actually peaceful.
- Tension can become dark/high-energy tracks rather than controlled tension.

## Recovery Audit

Recovery inputs:

- Current partial final tracks.
- Cluster-curated candidates or final candidate pool.
- Broad recovery library from liked songs capped by finalization pool cap.
- Original locked intent and constraints, then relaxed variants.

Recovery ranking:

- `broadEnergyRecoveryScore()` uses energy, valence, tempo, danceability.
- `intentCoherenceScore()` is added, but broad energy can still dominate.

Recovery expansion:

- For low-complexity or broad unconstrained/activity prompts, recovery can use full library candidates.
- Attempts include `activity_relaxed`, `mood_relaxed`, and `energy_recovery`.

Recovery selection:

- Runs through `finalizePlaylistTracks()`, but with altered intent in some attempts.

Can recovery introduce tracks that would never have survived the main pipeline?

- Yes. If activity, mood, energy, genre, era, or strict terms are removed or relaxed, recovery candidates can pass under a weaker intent than main V3.

Can recovery weaken emotional coherence?

- Yes. It can remove mood and energy-level intent, then rank by broad energy/valence.

Can recovery weaken scene identity?

- Yes. Scene is not preserved as a hard field in recovery.

Can recovery weaken subgenre identity?

- Yes. It can use full-library broad candidates, especially after prior retrieval already widened from subgenre to family/global.

Recovery risk: Critical.

## Relaxation Audit

Every observed relaxation point:

- `applyInterpretationBudget()`:
  - Trigger: low/medium prompt complexity and too many dimensions.
  - Widening: drops dimensions like era, mood, activity, or energy.
  - Sacrifice: explicit user dimensions can vanish before retrieval.

- `constrainPoolToIntentContract()`:
  - Trigger: no strict tracks with score >= 0.50.
  - Widening: accepts tracks with fit >= 0.34.
  - Sacrifice: non-required dimensions.

- `buildRetrievalPools()`:
  - Trigger: contract-safe pool below minimum broad retrieval pool.
  - Widening: family, adjacent, global.
  - Sacrifice: subgenre, family, mood/activity/scene.

- `structuredRetrievalScope()`:
  - Trigger: primary/related subgenre pool below threshold.
  - Widening: family pool.
  - Sacrifice: subgenre identity.

- `buildPlaylistPipeline()` starvation expansion:
  - Trigger: pre-ranking pool empty or below safe minimum.
  - Widening: same family, adjacent family, global.
  - Sacrifice: exact genre and scene.

- `buildV3CandidatePool()` relaxation plan:
  - Trigger: strict candidate count below minimum.
  - Widening: relax era, relax genre, relax audio, relax mood.
  - Sacrifice: era, genre, audio profile, mood.

- `RETRIEVAL_RELAXATION_LADDER` in V3:
  - Trigger: lane strict decisions below lane minimum.
  - Widening: strict, semi-relaxed, embedding-first, fallback-explore.
  - Sacrifice: structured constraints progressively.

- No-library search fallback:
  - Trigger: zero strict search results.
  - Widening: family query, then popular family/global query.
  - Sacrifice: subgenre, then genre.

- Metadata timebox partial retrieval:
  - Trigger: API timeout/failure.
  - Widening: continue with partial metadata.
  - Sacrifice: evidence confidence.

- `finalizePlaylistTracks()`:
  - Trigger: output below recovery threshold/completion target.
  - Widening: relax artist cap, album cap, cohesion, repeat signature, diversity cap.
  - Sacrifice: coherence and diversity.

- `recoverLowComplexityPlaylist()`:
  - Trigger: underfilled low-complexity/broad/activity playlist.
  - Widening: removes activity, mood, energy; can clear hard genres/era for activity recovery.
  - Sacrifice: core intent.

- strict genre evidence guard:
  - Trigger: insufficient verified genre evidence but enough final tracks.
  - Widening: best available playlist.
  - Sacrifice: verified genre purity.

- strict era evidence guard:
  - Trigger: zero verified era tracks but enough compatible unknowns.
  - Widening: compatible unknown-era tracks.
  - Sacrifice: verified era purity.

## Convergence Audit

Why different prompts converge:

- Genre family flattening:
  - `industrial techno warehouse rave`, `hard techno warehouse rave`, `dark warehouse techno`, and `underground techno bunker` all become electronic/techno/rave/party/dark/urban/energy.

- Influence force truncation:
  - V3 keeps top forces and normalizes them, so different long prompts can share the same top 3.

- Lane mappings:
  - `night`, `urban`, `electronic`, `party`, `energy`, and `dark` map to overlapping genre bonuses.

- Retrieval fallback:
  - Subgenre starvation collapses to family pool.

- Embedding retrieval:
  - Similar audio/scene vectors produce similar candidate clouds even when words differ.

- Diversity/cluster systems:
  - Coarse clusters by genre/era/energy/mood make many prompts use the same bins.

- Recovery:
  - Broad energy recovery can collapse different prompts into similar energy/valence playlists.

Examples:

- `industrial techno warehouse rave` vs `hard techno warehouse rave`:
  - Should differ: industrial harsher/darker, hard techno harder/faster.
  - Current convergence risk: both electronic + techno + rave + energy + party.

- `d&b rollers for night driving` vs `fast driving music`:
  - Should differ: d&b rollers requires drum-and-bass identity.
  - Current convergence risk: both driving + rhythm + energy unless subgenre guard holds.

- `melancholy rainy evening jazz` vs `rainy night walk`:
  - Should differ: jazz family and evening scene.
  - Current convergence risk: rainy/night/melancholy/introspective can pull to generic urban/indie/lofi.

- `90s boom bap for studying` vs `rap focus beats`:
  - Should differ: 90s boom bap era/subgenre.
  - Current convergence risk: both hip-hop + focus + rhythm if era/subgenre evidence is weak.

## Risk Ranking

### Critical

- Recovery can drop or null critical dimensions.
  - Location: `recoverLowComplexityPlaylist()`.
  - Impact: tracks can enter under weaker intent than main pipeline.

- Retrieval starvation can widen to global.
  - Location: `buildPlaylistPipeline()` pre-ranking expansion.
  - Impact: exact subgenre/scene can be sacrificed for non-empty output.

- V3 relaxation can drop era, genre, audio, mood.
  - Location: `buildV3CandidatePool()` and `constraint-relaxation.ts`.
  - Impact: downstream V3 can operate on a candidate set that no longer represents the original prompt.

- Dominant emotional state is not protected.
  - Location: system-wide.
  - Impact: subjective quality failures like "too angry", "not chill", "wrong vibe".

### High

- Unified intent averaging can dilute explicit prompt meaning.
  - Location: `unified-intent.ts`.

- No-library broad fallback can query `popular music`.
  - Location: `buildNoLibrarySpotifyCandidates()`.

- Lane force mappings are broad and can override scene specificity.
  - Location: `lane-router.ts`, `adaptive-lane-generator.ts`.

- Contrast/exploration lanes can pull away from identity.
  - Location: V3 lane generation and sampler.

- Era unknowns can still be treated as compatible in evidence relaxation.
  - Location: controller strict era evidence guard.

### Medium

- Artist/freshness/diversity penalties can demote exact-fit tracks.
  - Location: retrieval ranking, sampler, diversity pressure.

- Cluster mood is too coarse.
  - Location: `cluster-candidate-engine.ts`.

- Preferred cohesion families are inferred from candidates.
  - Location: finalization.

- Prompt hash variety can reorder tracks without semantic meaning.
  - Location: `promptOrderingBias()`.

### Low

- Diagnostics are rich but not always user-facing.
  - Location: controller response and UI.

- Some prompt-specific final guards are one-off instead of systemic.
  - Location: `finalTrackIsSafe()` prompt-specific helpers.

## Recommended Fixes Ordered By Impact

1. Create a single `DominantIntentContract`.
   - Include dominant genre family, dominant subgenre, dominant emotional state, activity, scene, era, and allowed relaxation policy.
   - It should be built once and passed through every stage.

2. Add a hard "intent survival gate" before final output.
   - Block or ask for broader prompt if final playlist does not meet minimum survival ratios.
   - Track separate survival scores for genre, subgenre, mood, emotion, scene, activity, era.

3. Make recovery contract-aware by default.
   - Recovery should never remove explicit genre, era, subgenre, activity, or dominant emotion without returning an explicit degraded-result error.
   - Remove broad energy recovery for explicit multi-dimensional prompts.

4. Replace recovery relaxation with ordered user-intent priorities.
   - Example: for `90s boom bap for studying`, preserve era + boom bap before study.
   - Example: for `d&b rollers for night driving`, preserve d&b rollers before generic driving.

5. Introduce protected dominant emotional state.
   - Infer one dominant emotional state and enforce it across retrieval, V3, recovery, and finalization.
   - Examples: melancholy, peacefulness, aggression, euphoria, anticipation, longing, nostalgia, tension.

6. Make subgenre survival explicit.
   - Track subgenre evidence count separately from family evidence.
   - If subgenre is explicit and survival falls below threshold, fail or ask to broaden.

7. Bound relaxation by dimension.
   - Genre/subgenre/era should not relax just because mood/activity pool is small.
   - Activity should not relax for activity-led prompts unless explicitly lower priority.

8. Remove global expansion for explicit prompts or gate it behind failure.
   - Global expansion should produce a "not enough exact matches" response, not silently publish.

9. Make no-library fallback stop at family for explicit genre prompts.
   - Avoid `popular music` unless user asked for broad discovery.

10. Add prompt convergence diagnostics.
    - Store normalized intent signature and candidate-pool signature.
    - Alert if different prompts converge above a threshold.

11. Make V3 contrast/exploration lanes conditional.
    - Disable contrast for strict subgenre/era prompts unless there is enough exact pool.

12. Upgrade mood clusters.
    - Replace energy/valence-only quadrants with richer emotion clusters: peaceful, tense, melancholic, euphoric, aggressive, longing, nostalgic, anticipatory.

13. Tie finalization cohesion to the original contract, not the candidate pool.
    - Prevent a drifted pool from defining its own "coherent" family.

14. Make evidence relaxations visible and optionally blocking.
    - If genre/era was relaxed, response should say so or return degraded-result metadata.

15. Add automated intent integrity benchmarks.
    - Use fixed prompts for genre, mood, scene, activity, era, and emotion.
    - Measure survival ratios across every pipeline stage.

## Release Readiness Assessment

Intent integrity is partially protected, but not yet release-grade for subjective playlist fidelity.

Reliability and timeout safety have improved, but those fixes intentionally favored completion. The next production risk is not "0 tracks" but "confidently generated wrong playlists." The system needs a global invariant that says: if the original prompt has explicit genre, subgenre, era, scene, activity, or dominant emotion, those dimensions must either survive or the system must fail gracefully instead of silently broadening.

Best next step: implement instrumentation first, not behavior changes. Add per-stage survival diagnostics for the five sample prompts, then use the diagnostics to decide which relaxation points should become bounded, blocked, or user-visible.

## Subagent Follow-Up Addendum

After the main report was drafted, three independent read-only traces completed and confirmed the same core conclusion: intent loss is distributed across duplicated parsers, retrieval starvation widening, V3 relaxation, sampler/diversity pressure, and controller-level finalization/recovery.

Additional concrete findings to preserve:

- The controller builds a local intent object from `buildCsspLockedIntent()`, `extractConstraintLayer()`, and diagnostic tag extraction before the playlist pipeline builds its own `IntentContract`, `UnifiedIntent`, and V3 locked intent. This means there is no single authoritative intent object.
- `buildConstraintRelaxationPlan()` labels five steps: strict, era relaxed, genre relaxed, audio relaxed, and mood relaxed. The returned relaxed intent actually removes `eraRange`, `genreFamilies`, and `mood`; audio relaxation is represented by the profile label rather than a returned intent field.
- `buildV3CandidatePool()` selects a relaxed candidate set when strict candidates are below the minimum. Once selected, that relaxed set is what V3 sees, so relaxation can happen before lane scoring and sampling.
- `retrieveCandidatesByEmbedding()` weights retrieval affinity around scene, taste, mood, energy, and drift. The subagent observed scene as the strongest component and taste/library centroid as still meaningful, so user history can pull even strong prompts toward familiar clusters.
- `runRecommendationEngine()` normalizes signals per lane, which can flatten absolute differences between high-fit and medium-fit tracks before final decision weighting.
- Diversity pressure is bounded but non-zero: track reuse, cluster saturation, family saturation, and artist memory can reorder close candidates. Artist memory can be especially strong because repeated artists are multiplied down aggressively.
- V3 sampler disables genre and era caps for explicit locked genre/era, which is good, but still applies energy, sequence, neighborhood, session artist, and structural selection logic.
- `buildClusters()` uses genre, era, energy band, and mood quadrant. Mood quadrant is derived from energy and valence only, so it cannot distinguish grief, longing, peacefulness, anticipation, liminality, or controlled tension.
- Controller final output is not simply V3 output. After `buildPlaylistPipeline()`, tracks pass through rehydration, curator identity scoring, cluster curation, finalization, evidence filtering, low-complexity recovery, and possible coherence repair before publishing.
- No-library mode has a strict entry requirement for explicit genre, but query fallback can still degrade from subgenre to family to broad popular searches under starvation/timebox pressure.

The subagent traces reinforce the release-readiness priority: add per-stage intent survival instrumentation before making more targeted prompt fixes. The diagnostics should answer whether drift happened during parsing, retrieval expansion, V3 relaxation, sampler/diversity, or controller finalization.
