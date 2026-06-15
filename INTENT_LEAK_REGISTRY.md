# Intent Leak Registry

Registry of known intent leak points now surfaced by the runtime diagnostics.

Scope: diagnostics only. No listed fix was implemented in this pass.

## Critical

### Retrieval Global Expansion

- File: `backend/core/playlist-pipeline.ts`
- Function: `buildPlaylistPipeline`
- Reason: retrieval starvation can widen the pool to global fallback.
- Affected dimensions: genre, subgenre, mood, scene, emotion
- Diagnostic evidence: `intentSurvival.leakDetections`, `intentContractGuard.fallbackLevelUsed`, `controlledGeneration.retrievalCompletionSafety`

### Recovery Path Activation

- File: `backend/controllers/generation.controller.ts`
- Function: `recoverLowComplexityPlaylist`
- Reason: recovery can complete a playlist from broadened pools and softened dimensions.
- Affected dimensions: mood, activity, energy, emotion, scene
- Diagnostic evidence: `generationDiagnostics.recoveryTriggered`, `generationDiagnostics.recoveryRelaxations`

### Strict Genre Evidence Relaxation

- File: `backend/controllers/generation.controller.ts`
- Function: `strictGenreEvidenceDiagnostics`
- Reason: explicit genre guard can relax to best available when enough tracks remain.
- Affected dimensions: genre, subgenre
- Diagnostic evidence: `strictGenreEvidence.relaxed`, `strictGenreEvidence.verifiedCount`, `strictGenreEvidence.requiredCount`

## High

### Subgenre To Family Fallback

- File: `backend/core/playlist-pipeline.ts`
- Function: `structuredRetrievalScope`
- Reason: scarce primary/related subgenre evidence can widen to genre family.
- Affected dimensions: subgenre, genre
- Diagnostic evidence: `intentContractGuard.subgenreFallbackMode`, `intentContractGuard.subgenrePrimaryCount`, `intentContractGuard.subgenreFamilyCount`

### Adjacent-Family Expansion

- File: `backend/core/playlist-pipeline.ts`
- Function: `buildPlaylistPipeline`
- Reason: starvation handling can retrieve adjacent family candidates.
- Affected dimensions: genre, subgenre, scene, emotion
- Diagnostic evidence: `intentContractGuard.fallbackLevelUsed`, `intentSurvival.relaxationAudit`

### V3 Constraint Relaxation

- File: `backend/core/v3/constraint-relaxation.ts`
- Function: `relaxedIntentForProfile`
- Reason: candidate pool construction can select a relaxed profile.
- Affected dimensions: genre, era, mood, energy, emotion
- Diagnostic evidence: `controlledGeneration.selectedRelaxation`, `controlledGeneration.relaxationSteps`

### No-Library Broad Search

- File: `backend/controllers/generation.controller.ts`
- Function: `noLibrarySearchQueries`
- Reason: Spotify fallback queries can broaden to family/popular searches.
- Affected dimensions: subgenre, mood, scene, era, emotion
- Diagnostic evidence: `noLibrarySpotify.fallbackReason`, `noLibrarySpotify.retrievalCompletion`

### Finalization Relaxed Fill

- File: `backend/controllers/generation.controller.ts`
- Function: `finalizePlaylistTracks`
- Reason: finalization can relax cohesion, artist limits, album limits, or hard-safe fill rules.
- Affected dimensions: genre, subgenre, scene, atmosphere, emotion
- Diagnostic evidence: `finalization.cohesionRelaxedFillUsed`, `finalization.hardSafeFillUsed`, `finalization.artistLimitRelaxed`, `finalization.albumLimitRelaxed`

### Strict Era Evidence Relaxation

- File: `backend/controllers/generation.controller.ts`
- Function: `strictEraEvidenceDiagnostics`
- Reason: era evidence can relax to compatible unknowns or activity recovery.
- Affected dimensions: era
- Diagnostic evidence: `strictEraEvidence.relaxed`, `strictEraEvidence.compatibleFallbackUsed`

## Medium

### Unified Intent Averaging

- File: `backend/core/unified-intent.ts`
- Function: `resolveUnifiedIntent`
- Reason: multiple intent representations can average away a dominant prompt state.
- Affected dimensions: mood, scene, emotion, energy
- Diagnostic evidence: `intentSurvival.stageTrace` stage `unified_intent`

### Embedding Retrieval Taste Pull

- File: `backend/core/v3/embedding-retrieval.ts`
- Function: `retrieveCandidatesByEmbedding`
- Reason: taste centroid, memory, scene, and mood vectors can pull retrieval toward library history.
- Affected dimensions: genre, mood, scene, emotion
- Diagnostic evidence: `embeddingRetrieval`, `recommendationEngine`, `intentSurvival.convergence`

### V3 Lane Contrast

- File: `backend/core/v3/pipeline.ts`
- Function: `runV3Pipeline`
- Reason: contrast, exploration, and bridge lanes can introduce alternate emotional or genre directions.
- Affected dimensions: emotion, mood, scene, energy, subgenre
- Diagnostic evidence: `lanes`, `laneContributions`, `selectionTrace`

### Cluster Selection Coarseness

- File: `backend/core/v3/cluster-builder.ts`
- Function: `buildClusters`
- Reason: cluster grouping can use broad mood/energy/genre signals.
- Affected dimensions: mood, emotion, scene
- Diagnostic evidence: `clusters`, `clusterDistributionGraph`, `aggregateClusterSpread`

## Low

### Artist Diversity Penalties

- File: `backend/core/v3/global-diversity-controller.ts`
- Function: `applyGlobalDiversityController`
- Reason: artist spread can slightly weaken narrow-scene or narrow-subgenre identity.
- Affected dimensions: genre, subgenre, scene
- Diagnostic evidence: `globalDiversityMetrics`, `artistDiversity`

### Prompt Interpretation Budget

- File: `backend/core/v3/intent.ts`
- Function: `applyInterpretationBudget`
- Reason: lower-complexity prompts can drop lower-priority inferred dimensions.
- Affected dimensions: mood, activity, era, atmosphere
- Diagnostic evidence: `stageTrace.prompt_parsing.evidence.interpretationBudget`

## Registry Usage

Use the registry with `intentSurvival.leakDetections`.

If a leak appears in the runtime payload, it means that generation took a path associated with known drift risk. It does not automatically mean the playlist is bad. The survival scores and final track evidence determine whether the leak became user-visible.
