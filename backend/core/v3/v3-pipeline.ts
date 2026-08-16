/**
 * V3.1+ Pipeline Orchestrator — Unified Routing System
 *
 * Replaces the V3 "score → sort → pick" implicit flow with an explicit
 * multi-stage decision pipeline:
 *
 *   1. Intent decomposition           (multi-axis, unchanged from V3)
 *   2. Adaptive lane generation       (NEW — dynamic, probabilistic)
 *   3. Candidate scoring per lane     (unchanged per-lane scorer)
 *   4. Constraint filtering           (hard reject only)
 *   5. Cluster formation              (groups before selection)
 *   6. Controlled sampler             (only stage with bounded randomness)
 *   7. Positional interleaving         (flow/order only)
 *   8. Diversity audit                (post-hoc diagnostics only)
 *
 * The V3 fallback ensemble (buildFallbackLanes) is preserved and used when
 * the adaptive generator also detects unclear intent.
 */

import type { EmotionProfile } from "../../lib/emotion";
import {
  buildIntentDecomposerDiagnostics,
  shouldUseFallbackEnsemble,
} from "./intent-decomposer";
import { buildLanes } from "./lane-router";
import { generateAdaptiveLanes } from "./adaptive-lane-generator";
import { scoreLane, type LaneScoredTrack } from "./lane-scorer";
import { buildClusters, type ClusteredPool } from "./cluster-candidate-engine";
import { selectFromClusters, type SampledLaneResult, type SamplerInterpretation } from "./v3-sampler";
import {
  resolveGenrePrototypeCentres,
  resolvePrototypeCentresForPromptWorlds,
  resolvePrototypeCentresForWorld,
  prototypeCentreScoreBoost,
} from "../editorial/genre-prototype-centres";
import {
  computeDominantWorldDensity,
  computeWorldCoherenceScore,
  scoreDominantWorldDensity,
  scoreFeelGoodLanePurity,
  scoreRetrievalEntropy,
} from "../editorial/world-coherence-score";
import {
  evaluateHumanQualityGate,
  HumanQualityGateError,
  type HumanQualityGateResult,
} from "../editorial/human-quality-gate";
import { isSemanticSpamTrack } from "../playlist-contract/contract-axis-scoring";
import { inferWorldIdentityIdsFromPrompt } from "../editorial/world-identity-gate";
import { resolveCommittedWorld } from "../committed-world";
import {
  evaluateIntentFidelity,
  selectIntentFidelityHonestPartialTracks,
} from "../editorial/intent-fidelity-gate";
import {
  evaluateWorldProof,
  filterTracksByWorldIdentity,
} from "../editorial/world-proof-gate";
import { enforceThesisOpener } from "../editorial/thesis-opener-gate";
import { resolveCulturalProfileForCommitted } from "../editorial/world-identity-score";
import { applySceneAnchorRetrievalQuota } from "../editorial/scene-anchor-retrieval-quota";
import { applyWorldSequencing } from "../editorial/world-sequencer";
import { applyWorldPurityGate, purityAwareComposeTarget } from "../editorial/world-purity-gate";
import { mergeDeliverableCandidatePools } from "../editorial/deliverable-depth-refill";
import { applyHumanCurationSequencing } from "../editorial/human-curation-sequencer";
import {
  filterTracksForDeliveryNegation,
  parsePromptNegationEnforcement,
} from "../../lib/prompt-negation-enforcement";
import { detectUkHipHopScene } from "../../lib/uk-hip-hop-scene";
import { promptSuppressesChristmas } from "../../lib/human-scene-knowledge";
import { artistEcosystemBoost, type ArtistEcosystemGraph } from "../../lib/artist-ecosystem-graph";
import {
  createDiversityWindow,
  updateDiversityWindow,
  computeDiversityMetrics,
} from "./global-diversity-controller";
import { interleaveLanes, type InterleavedResult } from "./interleaver";
import {
  auditEditorialPlaylist,
  scorePlaylistWorldMetrics,
} from "../scene-world-editorial-audit";
import {
  applyHumanSaveabilityPolishLayer,
  type EditorialLayerDiagnostics,
} from "../editorial/human-saveability-polish-layer";
import {
  applyHumanSaveabilityStabiliser,
  type EditorialStabiliserDiagnostics,
} from "../editorial/human-saveability-stabiliser";
import {
  buildIntentCollapseDiagnostics,
  buildSamplerIntentContext,
  collapseIntent,
  selectRankedCandidatesForSampler,
  calibrateIntentVectorForRetrievalPool,
  enrichIntentCollapseTrack,
  IntentCollapseInsufficientPoolError,
  minimumIntentPoolSize,
  intentPoolDeliveryFloor,
  applyPromptIntentModifiers,
  isIntentPoolBelowPreferred,
  recoverSamplerUniverse,
  targetSamplerUniverseSize,
  reinforceOpeningEditorialWorldLock,
  resolveEffectiveOpeningSize,
  absoluteIntentPoolFloor,
  hardLockVerifiedProceedTarget,
  salvageHardLockVerifiedTracks,
  type EditorialIntentVector,
  type IntentCollapseDiagnostics,
  type SamplerIntentContext,
  validateEditorialSceneWorldAlignment,
  validateDominantClusterAlignment,
  realignEditorialIntentWorldForArchetype,
  realignEditorialIntentForDominantGenres,
} from "../editorial/intent-collapse-layer";
import { improvePlaylistByLocalSearch } from "../editorial/playlist-local-search";
import { searchOptimalCompletePlaylist } from "../editorial/playlist-complete-search";
import {
  playlistBelievabilityScore,
  type PlaylistCurationScoringContext,
} from "../editorial/would-i-save-evaluator";
import {
  applyEditorialMemoryToIntent,
  resolveArchetypeFromMemory,
  type EditorialStructureMemory,
} from "../editorial/editorial-memory";
import {
  biasEnergyRangeForFingerprint,
  buildFingerprintBiasMap,
  type LibraryFingerprint,
} from "../editorial/library-fingerprint";
import { strictModeHumanSaveability, HumanSaveabilityGateError } from "../human-saveability-gate";
import { buildFastFallbackPlaylist } from "../../lib/fast-fallback-playlist";
import {
  minimumReturnableTrackCount,
  resolveGenerationDeliveryTier,
  type GenerationDeliveryTier,
} from "../../lib/generation-delivery-tier";
import {
  buildGateFailureExecutionTraceDraft,
  buildIntentCollapseFailureTraceDraft,
  buildV3PipelineExecutionTraceDraft,
  finalizeExecutionTrace,
  type IntentCollapseLayerTrace,
  type PlaylistExecutionTrace,
} from "../observability/playlist-execution-trace";
import { runHumanSaveabilityGateWithRetries } from "../human-saveability-pipeline";
import { isGenuinelyUsablePlaylist } from "../../lib/good-playlist-refinement-telemetry";
import {
  buildSceneWorldProofReport,
  createSceneWorldProofAccumulator,
  describeWorldRemovalReason,
  rankBeforeMembershipFilter,
  recordSceneWorldMembershipRemoval,
  recordSceneWorldProofAfter,
  recordSceneWorldProofBefore,
  type SceneWorldProofReport,
} from "../scene-world-proof-capture";
import {
  blendScoreWithWorldMembership,
  buildSceneWorldContext,
  computeWorldMembershipScore,
  type SceneWorldContext,
} from "../scene-world-layer";
import {
  buildSceneClusterFunnelReport,
  computeFirstTenClusterConsistency,
  computeSceneClusterMembershipScore,
  countTracksInDominantSceneCluster,
  describeSceneClusterViolation,
  openingDominantClusterPurity,
  openingSceneClusterThreshold,
  OPENING_TEN_DOMINANT_CLUSTER_MIN_PURITY,
  shouldRejectForSceneCluster,
  trackInDominantSceneCluster,
  type SceneClusterFunnelStage,
} from "../scene-cohesion-clusters";
import { classifyTrack, type TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { EraBucket } from "../../lib/intent-parser";
import type { V3MetadataTrack, V3TrackMetadata } from "../../lib/v3-track-contract";
import { trackHasKnownEraMismatch } from "../../lib/era-evidence";
import { normalizeLockedGenreFamily, type LockedIntent } from "./intent";
import {
  applySubSceneRetrievalTexture,
  buildSubSceneRetrievalPlan,
  mergeSubSceneIntoSamplerSelection,
  preferSubSceneSoftUniverse,
  selectSubSceneNeighbourhood,
} from "./subscene-retrieval";
import { computeSceneAlignmentScore, trackMatchesConstraints } from "./constraint-filter";
import {
  getRelaxationLevel,
  RETRIEVAL_RELAXATION_LADDER,
  retrieveCandidatesByEmbedding,
  type RetrievalCloud,
  type RetrievalStrictness,
  type RetrievedCandidate,
  type RetrievalTrackLike,
} from "./embedding-retrieval";
import { runRecommendationEngine } from "../engine/recommendation-engine";
import type { MomentMemory } from "../memory/moment-memory";
import {
  boundedTrackReusePenalty,
  buildDiversityTraceComponents,
  emptyDiversityTraceComponents,
  type DiversityTraceComponents,
} from "./diversity-pressure";
import {
  createTrackDecision,
  withDecisionAffinities,
  withDecisionFinalScore,
  withDecisionValidity,
  type TrackDecision,
} from "./track-decision";
import {
  type UnifiedIntentContext,
} from "../unified-intent";
import {
  artistExceedsSessionCap,
  artistMemoryCount,
  artistMemoryPenalty,
  sessionArtistMemoryDiagnostics,
  type SessionArtistMemory,
} from "./constraint-relaxation";
import { moduleLogger } from "../../lib/logger";
import { getFallbackCache, requestPatternKey, setFallbackCache } from "../../lib/fallback-cache";
import { createFailureContext, type FailureContext, type FailureType } from "../../lib/failure-types";
import {
  recordTraceCount,
  recordTraceDuration,
  recordTraceFailure,
  recordTraceFallback,
  recordTraceRecovery,
  type PipelineTrace,
} from "../../lib/pipeline-trace";
import { getSystemHealthState, recordSystemFailure } from "../../lib/system-health";

// ── Types ───────────────────────────────────────────────────────────────────

const log = moduleLogger("v3-pipeline");

export interface V3PipelineTrack extends RetrievalTrackLike {
  trackId: string;
  trackName?: string | null;
  artistName: string;
  albumName?: string | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo: number | null;
  releaseYear?: number | null;
}

export interface V3PipelineResult<T extends V3PipelineTrack> {
  finalTracks: Array<V3MetadataTrack<T>>;
  diagnostics: Record<string, unknown>;
  /** Internal — used by multi-candidate selection; not serialized to API payloads. */
  sceneWorldContext?: SceneWorldContext | null;
}

type V3SelectionCandidate<T extends V3PipelineTrack> = T & V3TrackMetadata & {
  sourceLane: string;
  laneScore: number;
  genrePrimary: string;
  laneEra: EraBucket;
  clusterIds: string[];
  diversity?: DiversityTraceComponents | null;
  clusterId?: string;
};

type ForensicStageTrace = {
  stage: string;
  before: number;
  after: number;
  removed: number;
  topReasons: Array<{ reason: string; count: number }>;
  sourceFile: string;
  functionName: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Shannon entropy normalised to [0,1] given the number of distinct keys. */
function shannonEntropyNormalized(dist: Record<string, number>): number {
  const total = Object.values(dist).reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  const n = Object.keys(dist).length;
  if (n <= 1) return 0;
  const raw = -Object.values(dist).reduce((s, v) => {
    const p = v / total;
    return s + (p > 0 ? p * Math.log2(p) : 0);
  }, 0);
  return Math.min(1, raw / Math.log2(n));
}

function resolvedDecisionGenreFamily<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): string | null {
  const classification = opts.classificationByTrack?.(decision.track.trackId);
  const metadataGenres = [
    ...(Array.isArray(decision.track.spotifyArtistGenres) ? decision.track.spotifyArtistGenres : []),
    ...(Array.isArray(decision.track.albumGenres) ? decision.track.albumGenres : []),
    ...(Array.isArray(decision.track.genres) ? decision.track.genres : []),
  ].filter((value): value is string => typeof value === "string");
  const directSignals = [
    classification?.genreFamily,
    classification?.genrePrimary,
    decision.track.genreFamily,
    decision.track.genrePrimary,
    decision.genrePrimary,
    ...metadataGenres,
  ];
  for (const signal of directSignals) {
    const normalized = normalizeLockedGenreFamily(signal);
    if (normalized) return normalized;
  }
  if (decision.track.trackName && decision.track.artistName) {
    const inferred = classifyTrack({
      trackName: decision.track.trackName,
      artistName: decision.track.artistName,
      albumName: decision.track.albumName ?? "",
      energy: decision.track.energy,
      valence: decision.track.valence,
      acousticness: decision.track.acousticness,
      danceability: decision.track.danceability,
      instrumentalness: decision.track.instrumentalness,
      speechiness: decision.track.speechiness,
      tempo: decision.track.tempo,
    });
    return normalizeLockedGenreFamily(inferred.genreFamily ?? inferred.genrePrimary);
  }
  return null;
}

function toSceneWorldTrack<T extends V3PipelineTrack>(
  track: T,
  opts: {
    genreByTrack?: (trackId: string) => string;
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
) {
  const classification = opts.classificationByTrack?.(track.trackId);
  const collapsed = enrichIntentCollapseTrack(
    {
      trackId: track.trackId,
      artistName: track.artistName,
      genrePrimary: opts.genreByTrack?.(track.trackId) ?? track.genrePrimary ?? null,
      genreFamily: track.genreFamily ?? classification?.genreFamily ?? null,
      energy: track.energy,
      valence: track.valence,
      danceability: track.danceability,
      acousticness: track.acousticness,
      tempo: track.tempo,
      speechiness: track.speechiness,
    },
    classification,
  );
  return {
    ...collapsed,
    albumName: (track as { albumName?: string | null }).albumName ?? null,
  };
}

function emptySceneClusterFunnelCounts(): Record<SceneClusterFunnelStage, number> {
  return {
    full_library: 0,
    retrieval: 0,
    retrieval_dominant_filter: 0,
    world_layer: 0,
    primary_family: 0,
    strict_cluster_filter: 0,
    sampler_pool: 0,
    opening5_pre_interleaver: 0,
    opening5_post_interleaver: 0,
  };
}

function decisionMatchesConstraints<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  lockedIntent: LockedIntent,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): boolean {
  const classification = opts.classificationByTrack?.(decision.track.trackId);
  const genreFamily = resolvedDecisionGenreFamily(decision, opts);
  return trackMatchesConstraints({
    ...decision.track,
    genreFamily: genreFamily ?? classification?.genreFamily ?? classification?.genrePrimary ?? decision.genrePrimary,
    genrePrimary: decision.genrePrimary,
    laneEra: decision.laneEra,
  }, lockedIntent);
}

function decisionIsLaneReady<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): boolean {
  const genreFamily = resolvedDecisionGenreFamily(decision, opts);
  return !!genreFamily &&
    decision.laneEra !== "any";
}

function laneReadinessRejectionReason<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): string | null {
  const genreFamily = resolvedDecisionGenreFamily(decision, opts);
  if (!genreFamily) return "missing genre";
  if (decision.laneEra === "any") return "lane readiness fail: missing era";
  return null;
}

function constraintRejectionReason<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  lockedIntent: LockedIntent,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): string | null {
  const classification = opts.classificationByTrack?.(decision.track.trackId);
  const genreFamily = resolvedDecisionGenreFamily(decision, opts);
  const track = {
    ...decision.track,
    genreFamily: genreFamily ?? classification?.genreFamily ?? classification?.genrePrimary ?? decision.genrePrimary,
    genrePrimary: decision.genrePrimary,
    laneEra: decision.laneEra,
  };
  if (!normalizeLockedGenreFamily(track.genreFamily) && !normalizeLockedGenreFamily(track.genrePrimary)) {
    return "missing genre";
  }
  if (lockedIntent.eraRange && !trackMatchesConstraints(track, lockedIntent)) {
    return "era mismatch";
  }
  if (!trackMatchesConstraints(track, lockedIntent)) return "constraint mismatch";
  return null;
}

function decisionHasBasicIdentity<T extends V3PipelineTrack>(decision: TrackDecision<T>): boolean {
  return !!decision.track.trackId &&
    !!decision.track.artistName;
}

function decisionHasUsableMetadata<T extends V3PipelineTrack>(decision: TrackDecision<T>): boolean {
  return decisionHasBasicIdentity(decision);
}

function decisionHasUsableGenre<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): boolean {
  return !!resolvedDecisionGenreFamily(decision, opts);
}

function eraAllowedWithDrift<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  lockedIntent: LockedIntent,
): boolean {
  if (!lockedIntent.eraRange) return true;
  return !trackHasKnownEraMismatch(decision.track, lockedIntent.eraRange);
}

function retrievalFloor(level: RetrievalStrictness): number {
  switch (level) {
    case "strict":
      return 0;
    case "semi_relaxed":
      return 0.42;
    case "embedding_first":
      return 0.34;
    case "fallback_explore":
      return 0;
  }
}

function decisionMatchesRelaxationLevel<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  lockedIntent: LockedIntent,
  level: RetrievalStrictness,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): boolean {
  if (level === "strict") {
    return decisionIsLaneReady(decision, opts) &&
      decisionMatchesConstraints(decision, lockedIntent, opts);
  }
  if (level === "fallback_explore") {
    return decisionHasBasicIdentity(decision);
  }
  if (!decisionHasUsableMetadata(decision)) return false;
  if (decision.embeddingAffinity < retrievalFloor(level)) return false;
  if (level === "semi_relaxed") {
    return decisionHasUsableGenre(decision, opts) &&
      eraAllowedWithDrift(decision, lockedIntent);
  }
  if (level === "embedding_first") {
    return true;
  }
  return true;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function topReasons(reasons: Record<string, number>): Array<{ reason: string; count: number }> {
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
}

function countReasons<T>(
  items: T[],
  reasonOf: (item: T) => string | null,
): Record<string, number> {
  const reasons: Record<string, number> = {};
  for (const item of items) {
    const reason = reasonOf(item);
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return reasons;
}

function stageTrace(
  stage: string,
  before: number,
  after: number,
  reasons: Record<string, number>,
  sourceFile: string,
  functionName: string,
): ForensicStageTrace {
  return {
    stage,
    before,
    after,
    removed: Math.max(0, before - after),
    topReasons: topReasons(reasons),
    sourceFile,
    functionName,
  };
}

type ScoreCarrier = {
  score?: number | null;
  hybridScore?: number | null;
};

function normalizedExistingScore(track: ScoreCarrier): number | null {
  const value = track.hybridScore ?? track.score;
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : null;
}

function attachHierarchicalAffinities<T extends V3PipelineTrack>(
  decisions: Array<TrackDecision<T>>,
  lockedIntent: LockedIntent,
  opts: {
    noveltyByTrack?: (trackId: string) => number;
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
    retrievalByTrack?: Map<string, RetrievedCandidate<T>>;
    sessionArtistMemory?: SessionArtistMemory;
    trackReusePenalty?: Map<string, number>;
    maxTastePullWeight?: number;
  },
): Array<TrackDecision<T>> {
  const tasteScale = Math.max(0.35, Math.min(1, (opts.maxTastePullWeight ?? 0.22) / 0.22));
  return decisions.map((decision) => {
    const classification = opts.classificationByTrack?.(decision.track.trackId);
    const genreFamily = resolvedDecisionGenreFamily(decision, opts) ??
      classification?.genreFamily ??
      classification?.genrePrimary ??
      decision.genrePrimary;
    const sceneAffinity = lockedIntent.sceneIntent
      ? computeSceneAlignmentScore({
          ...decision.track,
          genreFamily,
          genrePrimary: decision.genrePrimary,
          laneEra: decision.laneEra,
        }, lockedIntent.sceneIntent)
      : 0.5;
    const laneTaste = clamp01(decision.score / 1.5);
    const existingScore = normalizedExistingScore(decision.track as ScoreCarrier);
    const tasteAffinity = existingScore === null
      ? laneTaste
      : clamp01((laneTaste + existingScore) / 2);
    const freshnessAffinity = clamp01(opts.noveltyByTrack?.(decision.track.trackId) ?? 0.5);
    const retrieval = opts.retrievalByTrack?.get(decision.track.trackId);
    const sessionPenalty = artistMemoryPenalty(opts.sessionArtistMemory, decision.track.artistName);
    const sessionCapped = artistExceedsSessionCap(opts.sessionArtistMemory, decision.track.artistName);
    const recentTrackPenalty = opts.trackReusePenalty?.get(decision.track.trackId) ?? 0;
    const trackReusePenalty = boundedTrackReusePenalty(recentTrackPenalty);
    const trackReuseMultiplier = 1 - trackReusePenalty;
    const artistGravity = opts.sessionArtistMemory?.maxArtistAppearances
      ? artistMemoryCount(opts.sessionArtistMemory, decision.track.artistName) / opts.sessionArtistMemory.maxArtistAppearances
      : 0;
    const penalizedDecision = {
      ...decision,
      score: (decision.score ?? 0) * trackReuseMultiplier,
    };

    return withDecisionAffinities(penalizedDecision, {
      sceneAffinity,
      tasteAffinity: clamp01(tasteAffinity * tasteScale * sessionPenalty * (sessionCapped ? 0.45 : 1) * trackReuseMultiplier),
      freshnessAffinity: clamp01(freshnessAffinity * sessionPenalty * (sessionCapped ? 0.35 : 1) * trackReuseMultiplier),
      embeddingAffinity: retrieval?.embeddingAffinity,
      retrievalNeighborhood: retrieval?.retrievalNeighborhood,
      diversity: buildDiversityTraceComponents({
        artistMemoryMultiplier: sessionPenalty,
        recentTrackPenalty,
        trackReusePenalty,
        artistGravity,
      }),
    });
  });
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

async function yieldV3(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function emptyRetrievalCloud<T extends V3PipelineTrack>(): RetrievalCloud<T> {
  return {
    tracks: [],
    sessionState: {
      tasteVector: [],
      moodVector: [],
      sceneVector: [],
      energyVector: [],
      driftVector: [],
    },
    userTasteState: {
      longTermTasteVector: [],
      shortTermSessionVector: [],
      moodTrajectoryVector: [],
      scenePreferenceVector: [],
    },
    playlistEmbedding: {
      centroidVector: [],
      energyCurveVector: [],
      diversitySpreadVector: [],
      emotionalArcVector: [],
    },
    memoryGraph: {
      listenedTracksEmbeddingGraph: [],
      sessionTransitions: [],
      skippedClusters: {},
      replayedClusters: {},
    },
    clusterEmbeddings: [],
    neighborhoodCounts: {},
  };
}

async function safeStage<T>(opts: {
  stage: string;
  type: FailureType;
  requestId?: string;
  trace?: PipelineTrace;
  recover: () => T;
  run: () => T;
}): Promise<T> {
  try {
    return opts.run();
  } catch (firstErr) {
    const first = createFailureContext({
      stage: opts.stage,
      error: firstErr,
      requestId: opts.requestId,
      recoverable: true,
    });
    const context: FailureContext = { ...first, type: opts.type };
    recordTraceFailure(opts.trace, context);
    recordTraceRecovery(opts.trace, opts.stage, "recovery_attempted");
    // NB: do NOT record a *system-health* failure here. This is only a recovery
    // *attempt*; if recover() succeeds the user is served normally. Recording it
    // meant every recovered stage hiccup flipped system health to DEGRADED for a
    // full 60s window (system-health.ts), which silently bypasses clustering
    // lanes and the human-expectation hook. Only unrecovered failures (the
    // recovery_failed branch below) should degrade system health.
    log.warn(
      { requestId: opts.requestId, stage: opts.stage, type: context.type, recoverable: true, err: context.error },
      "recovery_attempted",
    );
    try {
      const recovered = opts.recover();
      recordTraceRecovery(opts.trace, opts.stage, "recovery_success");
      log.info({ requestId: opts.requestId, stage: opts.stage }, "recovery_success");
      return recovered;
    } catch (secondErr) {
      const second = createFailureContext({
        stage: opts.stage,
        error: secondErr,
        requestId: opts.requestId,
        recoverable: true,
      });
      const secondContext: FailureContext = { ...second, type: opts.type };
      recordTraceFailure(opts.trace, secondContext);
      recordTraceRecovery(opts.trace, opts.stage, "recovery_failed");
      recordTraceFallback(opts.trace, `${opts.stage}_fallback`);
      recordSystemFailure(secondContext);
      log.error(
        { requestId: opts.requestId, stage: opts.stage, type: secondContext.type, recoverable: true, err: secondContext.error },
        "recovery_failed",
      );
      throw secondErr;
    }
  }
}

function passThroughScored<T extends V3PipelineTrack>(
  tracks: T[],
  laneId: string,
): Array<LaneScoredTrack<T>> {
  return tracks.map((track) => ({
    track,
    laneScore: 0.5,
    signals: { ES: 0, SA: 0, EM: 0, Era: 0, Act: 0, Nov: 0, genreBonus: 0, eraBonus: 0, energyBandBonus: 0, coreGenrePenalty: 0 },
    era: "any" as EraBucket,
    genrePrimary: track.genrePrimary ?? track.genreFamily ?? "unknown",
  }));
}

function flatClusteredPool<T extends V3PipelineTrack>(
  decisions: Array<TrackDecision<T>>,
  laneId: string,
): ClusteredPool<T> {
  const clusterId = `${laneId}:flat`;
  const trackToClusterIds = new Map(decisions.map((decision) => [decision.track.trackId, [clusterId]]));
  return {
    clusters: new Map([
      [clusterId, {
        clusterId,
        dimension: "genre",
        value: "flat",
        trackIds: new Set(decisions.map((decision) => decision.track.trackId)),
        diversityContributionScore: 0,
        size: decisions.length,
      }],
    ]),
    trackToClusterIds,
    scoredTracks: decisions.map((decision) => ({ ...decision, clusterIds: [clusterId] })),
  };
}

function topNSelection<T extends V3PipelineTrack>(
  decisions: Array<TrackDecision<T>>,
  laneId: string,
  targetCount: number,
): ReturnType<typeof selectFromClusters<T>> {
  const tracks = decisions.slice(0, targetCount).map((decision) => ({
    ...decision.track,
    sourceLane: laneId,
    laneScore: decision.finalScore || decision.score,
    genrePrimary: decision.genrePrimary,
    laneEra: decision.laneEra,
    clusterIds: decision.clusterIds.length > 0 ? decision.clusterIds : [`${laneId}:flat`],
    diversity: decision.diversity,
  }));
  return {
    tracks,
    clusterSpread: {
      genreClusters: 1,
      eraClusters: 1,
      energyBands: 1,
      moodQuadrants: 1,
    },
    clusterSelectionRatios: { [`${laneId}:flat`]: tracks.length > 0 ? 1 : 0 },
    samplerDiagnostics: {
      inputCount: decisions.length,
      outputCount: tracks.length,
      rejectionReasons: {},
      topRejectionReasons: [],
      dominantCluster: `${laneId}:flat`,
      clusterPurity: 1,
      secondaryClusterAllowed: false,
      secondaryClusterReason: "fallback_top_n",
    },
  };
}

function minimalSelectedTracks<T extends V3PipelineTrack>(
  tracks: T[],
  targetCount: number,
): Array<T & V3SelectionCandidate<T>> {
  return tracks.slice(0, targetCount).map((track) => ({
    ...track,
    sourceLane: "minimal",
    laneScore: 0.5,
    genrePrimary: track.genrePrimary ?? track.genreFamily ?? "unknown",
    laneEra: "any" as EraBucket,
    clusterIds: ["minimal:flat"],
    clusterId: "minimal:flat",
    diversity: null,
    selectedByV3: true,
  })) as Array<T & V3SelectionCandidate<T>>;
}

function toSafeFallbackCandidate<T extends V3PipelineTrack>(
  track: T & Partial<V3SelectionCandidate<T>>,
): T & V3SelectionCandidate<T> {
  return {
    ...track,
    sourceLane: track.sourceLane ?? "safe_fallback",
    laneScore: track.laneScore ?? 0.5,
    genrePrimary: track.genrePrimary ?? track.genreFamily ?? "unknown",
    laneEra: track.laneEra ?? ("any" as EraBucket),
    clusterIds: track.clusterIds ?? ["safe:flat"],
    clusterId: track.clusterId ?? track.clusterIds?.[0] ?? "safe:flat",
    diversity: track.diversity ?? null,
    selectedByV3: true,
  } as T & V3SelectionCandidate<T>;
}

function assembleSafeV3Playlist<T extends V3PipelineTrack>(
  source: Array<T & Partial<V3SelectionCandidate<T>>>,
  profile: EmotionProfile,
  targetCount: number,
): Array<T & V3SelectionCandidate<T>> {
  if (source.length === 0) return [];
  const playlistLength = Math.min(targetCount, source.length);
  const ordered = buildFastFallbackPlaylist({
    tracks: source.map((track) => ({
      trackId: track.trackId,
      trackName: track.trackName ?? "Unknown",
      artistName: track.artistName,
      albumName: track.albumName ?? "",
      energy: track.energy,
      valence: track.valence,
      danceability: track.danceability,
      acousticness: track.acousticness,
      speechiness: track.speechiness ?? null,
      score: typeof track.laneScore === "number" ? track.laneScore : 0.5,
    })),
    emotionProfile: profile,
    playlistLength,
  });
  const byId = new Map(source.map((track) => [track.trackId, track]));
  return ordered
    .map((track) => byId.get(track.trackId))
    .filter((track): track is T & Partial<V3SelectionCandidate<T>> => !!track)
    .map((track) => toSafeFallbackCandidate(track));
}

function openingClusterAudit<T extends V3PipelineTrack>(
  tracks: Array<T & V3SelectionCandidate<T>>,
  context: SceneWorldContext | null,
  openingCount = 5,
): {
  openingClusterPurity: number;
  openingClusterViolations: Array<{ trackId: string; artist: string; rank: number }>;
  openingRepairCount: number;
  dominantClusterId: string | null;
  dominantClusterLabel: string | null;
} {
  if (!context?.sceneClusters || tracks.length === 0) {
    return {
      openingClusterPurity: 0,
      openingClusterViolations: [],
      openingRepairCount: 0,
      dominantClusterId: null,
      dominantClusterLabel: null,
    };
  }
  const opening = tracks.slice(0, openingCount);
  const dominantClusterId = context.sceneClusters.dominantClusterId;
  const dominantClusterLabel = context.sceneClusters.dominantCluster.label;
  const violations = opening
    .map((track, idx) => ({ track, rank: idx + 1 }))
    .filter(({ track, rank }) => {
      const sceneClusterId = context.sceneClusters!.trackToClusterId.get(track.trackId);
      if (sceneClusterId !== dominantClusterId) return true;
      return computeSceneClusterMembershipScore(track, context) < openingSceneClusterThreshold(rank - 1);
    })
    .map(({ track, rank }) => ({
      trackId: track.trackId,
      artist: track.artistName,
      rank,
    }));
  const purity = opening.length > 0 ? (opening.length - violations.length) / opening.length : 0;
  return {
    openingClusterPurity: Math.round(purity * 1000) / 1000,
    openingClusterViolations: violations,
    openingRepairCount: 0,
    dominantClusterId,
    dominantClusterLabel,
  };
}

export async function runV3Pipeline<T extends V3PipelineTrack>(
  tracks: T[],
  vibe: string,
  profile: EmotionProfile,
  targetCount: number,
  opts: {
    genreByTrack?: (trackId: string) => string;
    noveltyByTrack?: (trackId: string) => number;
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
    seed?: number;
    lockedIntent?: LockedIntent;
    unifiedIntentContext?: UnifiedIntentContext;
    momentMemory?: MomentMemory | null;
    sessionArtistMemory?: SessionArtistMemory;
    trackReusePenalty?: Map<string, number>;
    requestId?: string;
    pipelineTrace?: PipelineTrace;
    diagnosticsMode?: "minimal" | "full";
    profileStage?: (stage: string, detail?: string) => () => void;
    shouldSkipMarginalImprovement?: () => boolean;
    onGoodPlaylistReady?: (snapshot: {
      tracks: import("../editorial/human-playlist-patterns").PatternScoringTrack[];
      deliverableTracks: T[];
      scoringContext: PlaylistCurationScoringContext;
    }) => void;
    dominantIntentGates?: {
      dominantEmotionExplicit?: boolean;
      allowContrastLanes?: boolean;
      allowExplorationLanes?: boolean;
      maxTasteWeight?: number;
    };
    sceneWorldProof?: boolean;
    playlistAdjacency?: Array<{ trackIds: string[] }>;
    likedAdjacency?: Array<{ trackId: string; addedAt?: string | Date | null }>;
    editorialMemory?: EditorialStructureMemory | null;
    libraryFingerprint?: LibraryFingerprint | null;
    samplerInterpretation?: SamplerInterpretation;
    artistEcosystemGraph?: ArtistEcosystemGraph | null;
    /** Hard world lock — verified in-world tracks bypass strict intent floors. */
    hardWorldLock?: boolean;
    worldVerifiedTrackIds?: Set<string>;
    /** Full verified track rows when IDs outlive the scored candidate pool. */
    worldVerifiedTracks?: T[];
    /** V41: let post-V3 contract rebalance recover instead of refusing stub playlists. */
    deferHumanSaveGateForContractComposition?: boolean;
  } = {},
): Promise<V3PipelineResult<T>> {
  const pipelineStartedAt = Date.now();
  const fullDiagnostics = opts.diagnosticsMode === "full";
  const timingMs: Record<string, number> = {
    retrieval: 0,
    laneGeneration: 0,
    scoring: 0,
    candidateGeneration: 0,
    sampler: 0,
    interleaver: 0,
    intentExpansion: 0,
    completeSearch: 0,
    localSearch: 0,
    tournament: 0,
    humanSaveability: 0,
    total: 0,
  };
  const recordTiming = (key: keyof typeof timingMs, startedAt: number): void => {
    const durationMs = Date.now() - startedAt;
    timingMs[key] += durationMs;
    recordTraceDuration(opts.pipelineTrace, `v3.${key}`, durationMs);
    log.info({ requestId: opts.requestId, stage: key, durationMs }, "v3_stage_completed");
  };

  // ── Stage 1: Unified intent consumption ──────────────────────────────────
  if (!opts.unifiedIntentContext) {
    throw new Error("UnifiedIntent required — raw prompt parsing disabled");
  }
  const unifiedIntentContext = opts.unifiedIntentContext;
  const decomposed = unifiedIntentContext.v3DecomposedIntent;
  const lockedIntent = opts.lockedIntent ?? unifiedIntentContext.lockedIntent;
  const inferredWorldIds = inferWorldIdentityIdsFromPrompt(vibe);
  const ukScene = detectUkHipHopScene(vibe);
  const worldPrototypeCentres = resolvePrototypeCentresForPromptWorlds(
    inferredWorldIds,
    ukScene?.active ? ukScene.id : null,
  );
  const genrePrototypeCentres = [
    ...worldPrototypeCentres,
    ...resolveGenrePrototypeCentres({
      vibe,
      primarySubgenre: lockedIntent.primarySubgenre ?? null,
      genreFamilies: lockedIntent.genreFamilies,
    }).filter((centre) => !worldPrototypeCentres.some((w) => w.id === centre.id)),
  ].slice(0, 4);
  const unifiedIntentDiagnostics = unifiedIntentContext.diagnostics;
  const humanSaveStrictMode = strictModeHumanSaveability(vibe, lockedIntent);
  let effectiveHumanSaveStrict = humanSaveStrictMode;
  const noteReliabilityFallback = (name: string): void => {
    recordTraceFallback(opts.pipelineTrace, name);
  };
  const intentDecomposer = buildIntentDecomposerDiagnostics(decomposed, vibe, lockedIntent);
  decomposed.fallbackRouting = intentDecomposer;
  const fallbackTriggered = shouldUseFallbackEnsemble(decomposed, vibe, lockedIntent);
  const healthState = getSystemHealthState();
  const overloaded = healthState === "DEGRADED" || healthState === "CRITICAL";
  if (overloaded) recordTraceFallback(opts.pipelineTrace, `system_health_${healthState.toLowerCase()}`);
  const retrievalInputTracks = healthState === "CRITICAL"
    ? tracks.slice(0, Math.max(targetCount, targetCount * 3))
    : tracks;
  const preRetrievalSceneWorld = buildSceneWorldContext({
    vibe,
    lockedIntent,
    tracks: retrievalInputTracks.map((track) => toSceneWorldTrack(track, opts)),
    seed: opts.seed != null ? String(opts.seed) : vibe,
    playlistAdjacency: opts.playlistAdjacency,
    likedAdjacency: opts.likedAdjacency,
  });
  const intentExpansionStartedAt = Date.now();
  const collapsedIntent = collapseIntent({
    vibe,
    lockedIntent,
    profile,
    seed: opts.seed,
    strictMode: humanSaveStrictMode,
    libraryTracks: tracks.map((track) => toSceneWorldTrack(track, opts)),
    targetCount,
    sceneArchetypeId: resolveArchetypeFromMemory(
      preRetrievalSceneWorld?.archetype?.id ?? null,
      opts.editorialMemory ?? null,
    ),
  });
  recordTiming("intentExpansion", intentExpansionStartedAt);
  const committedWorld = resolveCommittedWorld({
    prompt: vibe,
    lockedIntent,
    editorialWorldTag: collapsedIntent.intent.editorialWorldTag,
  });
  const activeCommittedWorldId = committedWorld?.id ?? inferredWorldIds[0] ?? null;
  let editorialIntentVector: EditorialIntentVector = applyPromptIntentModifiers(
    collapsedIntent.intent,
    vibe,
  );
  if (opts.editorialMemory) {
    editorialIntentVector = applyEditorialMemoryToIntent(editorialIntentVector, opts.editorialMemory);
  }
  if (opts.libraryFingerprint) {
    editorialIntentVector = {
      ...editorialIntentVector,
      energyRange: biasEnergyRangeForFingerprint(
        editorialIntentVector.energyRange,
        opts.libraryFingerprint,
      ),
    };
  }
  let activeEditorialIntentVector: EditorialIntentVector = editorialIntentVector;
  let samplerIntentContext: SamplerIntentContext = buildSamplerIntentContext(editorialIntentVector);
  let intentCollapseDiagnostics: IntentCollapseDiagnostics | null = buildIntentCollapseDiagnostics(
    editorialIntentVector,
    collapsedIntent.collapseConfidenceScore,
    0,
    0,
  );
  const intentCollapseTrace = (): IntentCollapseLayerTrace => ({
    primaryMood: editorialIntentVector.primaryMood,
    editorialWorldTag: editorialIntentVector.editorialWorldTag,
    energyRange: editorialIntentVector.energyRange,
    rhythmDensityCap: editorialIntentVector.rhythmDensityCap,
    allowedMicroClusters: editorialIntentVector.allowedMicroClusters,
    collapseConfidenceScore: collapsedIntent.collapseConfidenceScore,
  });
  const worldAlignment = validateEditorialSceneWorldAlignment(
    editorialIntentVector.editorialWorldTag,
    preRetrievalSceneWorld?.archetype?.id,
  );
  if (preRetrievalSceneWorld?.active && !worldAlignment.aligned && preRetrievalSceneWorld.archetype?.id && !committedWorld?.hardLock) {
    const realigned = realignEditorialIntentWorldForArchetype(
      editorialIntentVector,
      preRetrievalSceneWorld.archetype.id,
    );
    if (realigned) {
      editorialIntentVector = realigned;
      activeEditorialIntentVector = realigned;
      samplerIntentContext = buildSamplerIntentContext(realigned);
    }
  }
  const worldAlignmentAfterRealign = validateEditorialSceneWorldAlignment(
    editorialIntentVector.editorialWorldTag,
    preRetrievalSceneWorld?.archetype?.id,
  );
  if (preRetrievalSceneWorld?.active && !worldAlignmentAfterRealign.aligned && !committedWorld?.hardLock) {
    const dominantGenres = preRetrievalSceneWorld.sceneClusters?.dominantCluster.dominantGenres ?? [];
    const genreFallback = dominantGenres.length > 0
      ? realignEditorialIntentForDominantGenres(editorialIntentVector, dominantGenres)
      : null;
    if (genreFallback) {
      editorialIntentVector = genreFallback;
      activeEditorialIntentVector = genreFallback;
      samplerIntentContext = buildSamplerIntentContext(genreFallback);
    }
  }
  const worldAlignmentFinal = validateEditorialSceneWorldAlignment(
    editorialIntentVector.editorialWorldTag,
    preRetrievalSceneWorld?.archetype?.id,
  );
  if (preRetrievalSceneWorld?.active && !worldAlignmentFinal.aligned) {
    noteReliabilityFallback("world_alignment_degraded_continue");
    effectiveHumanSaveStrict = false;
  }
  const clusterAlignment = validateDominantClusterAlignment(
    editorialIntentVector.editorialWorldTag,
    preRetrievalSceneWorld?.sceneClusters?.dominantCluster.label,
    preRetrievalSceneWorld?.sceneClusters?.dominantCluster.dominantGenres,
  );
  if (preRetrievalSceneWorld?.sceneClusters && !clusterAlignment.aligned && !committedWorld?.hardLock) {
    const dominantGenres = preRetrievalSceneWorld.sceneClusters.dominantCluster.dominantGenres ?? [];
    const clusterRealigned = realignEditorialIntentForDominantGenres(
      editorialIntentVector,
      dominantGenres,
    );
    if (clusterRealigned) {
      editorialIntentVector = clusterRealigned;
      activeEditorialIntentVector = clusterRealigned;
      samplerIntentContext = buildSamplerIntentContext(clusterRealigned);
    }
  }
  const clusterAlignmentAfterRealign = validateDominantClusterAlignment(
    editorialIntentVector.editorialWorldTag,
    preRetrievalSceneWorld?.sceneClusters?.dominantCluster.label,
    preRetrievalSceneWorld?.sceneClusters?.dominantCluster.dominantGenres,
  );
  if (preRetrievalSceneWorld?.sceneClusters && !clusterAlignmentAfterRealign.aligned) {
    noteReliabilityFallback("dominant_cluster_world_degraded_continue");
    effectiveHumanSaveStrict = false;
  }
  const strictPrimaryFamilies = new Set(
    (preRetrievalSceneWorld?.archetype?.genreFamilies ?? lockedIntent.genreFamilies ?? [])
      .map((f) => f.toLowerCase()),
  );
  const effectiveIntentGates = (preRetrievalSceneWorld?.strictMode || effectiveHumanSaveStrict)
    ? {
        dominantEmotionExplicit: true,
        allowContrastLanes: false,
        allowExplorationLanes: false,
        maxTasteWeight: Math.min(0.12, opts.dominantIntentGates?.maxTasteWeight ?? 0.22),
      }
    : opts.dominantIntentGates;
  const retrievalCacheKey = requestPatternKey("v3-retrieval", {
    vibe,
    targetCount,
    healthState,
    genreFamilies: lockedIntent.genreFamilies,
    eraRange: lockedIntent.eraRange,
    trackCount: tracks.length,
  });
  const outputCacheKey = requestPatternKey("v3-output", {
    vibe,
    targetCount,
    genreFamilies: lockedIntent.genreFamilies,
    eraRange: lockedIntent.eraRange,
    trackCount: tracks.length,
  });
  let stageStartedAt = Date.now();
  const endRetrievalProfile = opts.profileStage?.("v3.retrieval", `${retrievalInputTracks.length} input tracks`);
  let retrievalCloud: RetrievalCloud<T>;
  try {
    retrievalCloud = await safeStage<RetrievalCloud<T>>({
      stage: "v3.retrieval",
      type: "RETRIEVAL_FAILURE",
      requestId: opts.requestId,
      trace: opts.pipelineTrace,
      run: () => {
        const cloud = retrieveCandidatesByEmbedding(
          retrievalInputTracks,
          lockedIntent,
          unifiedIntentContext.unifiedIntent,
          { maxTasteWeight: effectiveIntentGates?.maxTasteWeight },
        );
        setFallbackCache(retrievalCacheKey, cloud);
        return cloud;
      },
      recover: () => getFallbackCache<RetrievalCloud<T>>(retrievalCacheKey) ?? emptyRetrievalCloud<T>(),
    });
  } finally {
    endRetrievalProfile?.();
  }
  recordTiming("retrieval", stageStartedAt);
  recordTraceCount(opts.pipelineTrace, "v3.retrievalCandidates", retrievalCloud.tracks.length);
  await yieldV3();
  const forensicTrace: ForensicStageTrace[] = [
    stageTrace(
      "retrieval result count",
      tracks.length,
      retrievalCloud.tracks.length,
      retrievalCloud.tracks.length < tracks.length ? { retrieval_cloud_limit_or_filter: tracks.length - retrievalCloud.tracks.length } : {},
      "backend/core/v3/embedding-retrieval.ts",
      "retrieveCandidatesByEmbedding",
    ),
  ];
  const sceneClusterFunnelCounts = emptySceneClusterFunnelCounts();
  sceneClusterFunnelCounts.full_library = countTracksInDominantSceneCluster(
    retrievalInputTracks.map((track) => track.trackId),
    preRetrievalSceneWorld,
  );
  sceneClusterFunnelCounts.retrieval = countTracksInDominantSceneCluster(
    retrievalCloud.tracks.map((candidate) => candidate.track.trackId),
    preRetrievalSceneWorld,
  );

  let retrievalDominantFilterApplied = false;
  let activeRetrievalCloud = retrievalCloud;
  if (effectiveHumanSaveStrict && preRetrievalSceneWorld?.sceneClusters) {
    const dominantId = preRetrievalSceneWorld.sceneClusters.dominantClusterId;
    const minIntentPoolEarly = minimumIntentPoolSize(targetCount, effectiveHumanSaveStrict);
    const minDominantPool = Math.max(12, Math.ceil(targetCount * 1.1));
    const dominantOnly = activeRetrievalCloud.tracks.filter(
      (candidate) => preRetrievalSceneWorld.sceneClusters!.trackToClusterId.get(candidate.track.trackId) === dominantId,
    );
    if (dominantOnly.length >= minDominantPool && dominantOnly.length >= Math.floor(minIntentPoolEarly * 0.8)) {
      activeRetrievalCloud = { ...activeRetrievalCloud, tracks: dominantOnly };
      retrievalDominantFilterApplied = true;
    }
  }
  if (retrievalDominantFilterApplied) {
    retrievalCloud = activeRetrievalCloud;
  }
  let retrievedTracks = activeRetrievalCloud.tracks.map((candidate) => candidate.track);
  const preIntentFilterCount = retrievedTracks.length;
  const hardLockVerifiedIds = opts.hardWorldLock ? opts.worldVerifiedTrackIds : undefined;
  const verifiedTrackById = new Map<string, T>();
  for (const track of tracks) verifiedTrackById.set(track.trackId, track);
  if (opts.worldVerifiedTracks) {
    for (const track of opts.worldVerifiedTracks) {
      if (!verifiedTrackById.has(track.trackId)) verifiedTrackById.set(track.trackId, track);
    }
  }
  if (hardLockVerifiedIds && hardLockVerifiedIds.size > 0) {
    const presentIds = new Set(retrievedTracks.map((track) => track.trackId));
    for (const track of tracks) {
      if (!hardLockVerifiedIds.has(track.trackId) || presentIds.has(track.trackId)) continue;
      const verified = verifiedTrackById.get(track.trackId) ?? track;
      retrievedTracks.push(verified);
      presentIds.add(track.trackId);
    }
    if (presentIds.size > preIntentFilterCount) {
      noteReliabilityFallback(`hard_lock_verified_retrieval_merge_${presentIds.size}`);
    }
  }
  const intentFilterTracks = retrievedTracks.map((track) =>
    enrichIntentCollapseTrack(track, opts.classificationByTrack?.(track.trackId)),
  );
  // Sub-scene neighbourhood must see the full library — soft remnant tracks often
  // rank poorly on embedding affinity for peak-electronic prompts and never enter
  // the affinity cloud, which is exactly the comedown failure mode.
  const fullLibraryCollapseTracks = (() => {
    const seen = new Set<string>();
    const rows: T[] = [];
    const push = (track: T) => {
      if (seen.has(track.trackId)) return;
      seen.add(track.trackId);
      rows.push(track);
    };
    for (const track of tracks) push(track);
    if (opts.worldVerifiedTracks) {
      for (const track of opts.worldVerifiedTracks) push(track);
    }
    return rows.map((track) =>
      enrichIntentCollapseTrack(track, opts.classificationByTrack?.(track.trackId)),
    );
  })();
  const calibratedIntentVector = calibrateIntentVectorForRetrievalPool(
    intentFilterTracks,
    editorialIntentVector,
    { targetCount, strictMode: effectiveHumanSaveStrict },
  );
  const subScenePlan = buildSubSceneRetrievalPlan({
    vibe,
    lockedIntent,
    libraryTracks: fullLibraryCollapseTracks,
    targetCount,
  });
  const subSceneIntentVector = applySubSceneRetrievalTexture(calibratedIntentVector, subScenePlan);
  const fingerprintBias = opts.libraryFingerprint
    ? buildFingerprintBiasMap(intentFilterTracks, opts.libraryFingerprint)
    : undefined;
  const samplerHardLockOpts = opts.hardWorldLock
    ? { hardWorldLock: true as const, worldVerifiedIds: hardLockVerifiedIds }
    : {};
  let rankedSelection = selectRankedCandidatesForSampler(
    intentFilterTracks,
    subSceneIntentVector,
    {
      targetCount,
      strictMode: effectiveHumanSaveStrict,
      fingerprintBias,
      ...samplerHardLockOpts,
    },
  );
  if (subScenePlan.kind !== "none") {
    const neighbourhood = selectSubSceneNeighbourhood(
      fullLibraryCollapseTracks,
      subSceneIntentVector,
      subScenePlan,
    );
    rankedSelection = mergeSubSceneIntoSamplerSelection(
      rankedSelection,
      neighbourhood,
      subSceneIntentVector,
      subScenePlan,
    );
    if (neighbourhood.length > 0) {
      noteReliabilityFallback(`subscene_retrieval_${subScenePlan.kind}`);
      const presentIds = new Set(retrievedTracks.map((track) => track.trackId));
      const byLibraryId = new Map(tracks.map((track) => [track.trackId, track]));
      for (const soft of neighbourhood) {
        if (presentIds.has(soft.trackId)) continue;
        const original = byLibraryId.get(soft.trackId);
        if (!original) continue;
        retrievedTracks.push(original);
        presentIds.add(soft.trackId);
      }
    }
  }
  if (rankedSelection.selected.length < minimumIntentPoolSize(targetCount, effectiveHumanSaveStrict)) {
    rankedSelection = recoverSamplerUniverse(
      intentFilterTracks,
      subSceneIntentVector,
      rankedSelection,
      {
        targetCount,
        strictMode: effectiveHumanSaveStrict,
        fingerprintBias,
        ...samplerHardLockOpts,
      },
    );
    noteReliabilityFallback("intent_pool_recovery_expand");
  }
  // Soft-universe preference must run after recovery so expand cannot re-flood peak.
  if (subScenePlan.kind !== "none") {
    rankedSelection = preferSubSceneSoftUniverse(rankedSelection, subScenePlan, targetCount);
  }
  const selectedTrackIds = new Set(rankedSelection.selected.map((track) => track.trackId));
  if (opts.hardWorldLock && hardLockVerifiedIds) {
    for (const trackId of hardLockVerifiedIds) selectedTrackIds.add(trackId);
  }
  retrievedTracks = retrievedTracks
    .filter((track) => selectedTrackIds.has(track.trackId))
    .sort((a, b) => {
      const scoreA = rankedSelection.scores.get(a.trackId) ?? 0;
      const scoreB = rankedSelection.scores.get(b.trackId) ?? 0;
      return scoreB - scoreA;
    })
    .map((track) => {
      const enriched = intentFilterTracks.find((row) => row.trackId === track.trackId);
      if (!enriched) return track;
      return {
        ...track,
        genreFamily: enriched.genreFamily ?? track.genreFamily ?? null,
        genrePrimary: enriched.genrePrimary ?? track.genrePrimary ?? null,
      };
    });
  if (opts.hardWorldLock && hardLockVerifiedIds && hardLockVerifiedIds.size > 0) {
    const presentIds = new Set(retrievedTracks.map((track) => track.trackId));
    for (const track of tracks) {
      if (!hardLockVerifiedIds.has(track.trackId) || presentIds.has(track.trackId)) continue;
      const verified = verifiedTrackById.get(track.trackId) ?? track;
      retrievedTracks.push(verified);
      presentIds.add(track.trackId);
    }
    noteReliabilityFallback(`hard_lock_verified_retrieval_union_${retrievedTracks.length}`);
  }
  if (subScenePlan.kind === "soft_electronic_aftermath" || subScenePlan.kind === "soft_focus_concentration") {
    const energyHi = subScenePlan.energyHi ?? subSceneIntentVector.energyRange[1] ?? 0.62;
    const softOnly = retrievedTracks.filter((track) => {
      const energy = typeof track.energy === "number" ? track.energy : null;
      return energy != null && energy <= energyHi;
    });
    // Force comedown/focus lanes to compose from soft remnant only when supply exists.
    if (softOnly.length >= 1) {
      retrievedTracks = softOnly;
    }
  }
  // Early retrieval density soft-rerank: when the first window spans too many
  // unrelated worlds, prefer tracks from the emerging dominant family/ecosystem
  // without hard-emptying the pool (Spotify editorial density, not diversity spam).
  {
    const entropy = scoreRetrievalEntropy(retrievedTracks, 20);
    const density = computeDominantWorldDensity(retrievedTracks);
    if (
      entropy >= 0.68 &&
      density.dominantFamily &&
      density.dominantShare < 0.45 &&
      lockedIntent.genreFamilies.length > 0
    ) {
      const preferred = new Set(
        lockedIntent.genreFamilies.map((f) => f.toLowerCase()).concat(density.dominantFamily),
      );
      retrievedTracks = [...retrievedTracks].sort((a, b) => {
        const af = (a.genreFamily ?? a.genrePrimary ?? "unknown").toLowerCase();
        const bf = (b.genreFamily ?? b.genrePrimary ?? "unknown").toLowerCase();
        const aOk = preferred.has(af) ? 1 : 0;
        const bOk = preferred.has(bf) ? 1 : 0;
        if (aOk !== bOk) return bOk - aOk;
        return 0;
      });
      noteReliabilityFallback("retrieval_entropy_density_soft_rerank");
    }
  }
  const postIntentFilterCount = retrievedTracks.length;
  activeEditorialIntentVector = subSceneIntentVector;
  samplerIntentContext = buildSamplerIntentContext(subSceneIntentVector);
  intentCollapseDiagnostics = {
    ...buildIntentCollapseDiagnostics(
      subSceneIntentVector,
      collapsedIntent.collapseConfidenceScore,
      preIntentFilterCount,
      postIntentFilterCount,
      intentFilterTracks,
    ),
    rankedSelectionAvgScore: rankedSelection.avgScore,
    rankedSelectionFloor: rankedSelection.minScoreUsed,
    targetUniverseSize: targetSamplerUniverseSize(targetCount, humanSaveStrictMode),
    universeCoverage: postIntentFilterCount / Math.max(1, targetSamplerUniverseSize(targetCount, humanSaveStrictMode)),
  };
  forensicTrace.push(stageTrace(
    "intent collapse ranked selection",
    preIntentFilterCount,
    postIntentFilterCount,
    preIntentFilterCount > postIntentFilterCount
      ? {
        intent_vector_ranked_selection: preIntentFilterCount - postIntentFilterCount,
        ranked_avg_score: rankedSelection.avgScore,
        ranked_floor: rankedSelection.minScoreUsed,
      }
      : { ranked_avg_score: rankedSelection.avgScore },
    "backend/core/editorial/intent-collapse-layer.ts",
    "selectRankedCandidatesForSampler",
  ));
  const preferredIntentPool = minimumIntentPoolSize(targetCount, effectiveHumanSaveStrict);
  const targetUniverse = targetSamplerUniverseSize(targetCount, effectiveHumanSaveStrict);
  const verifiedInWorldDepth = hardLockVerifiedIds?.size ?? 0;
  const deliveryPoolFloor = intentPoolDeliveryFloor(targetCount, {
    hardWorldLock: opts.hardWorldLock,
    verifiedInWorldDepth,
  });
  if (retrievedTracks.length < preferredIntentPool && retrievalInputTracks.length > retrievedTracks.length) {
    const backfillIds = new Set(retrievedTracks.map((track) => track.trackId));
    const energyHi =
      subScenePlan.kind === "soft_electronic_aftermath" ||
      subScenePlan.kind === "soft_focus_concentration"
        ? (subScenePlan.energyHi ?? subSceneIntentVector.energyRange[1] ?? 0.62)
        : null;
    const backfillSource =
      energyHi == null
        ? retrievalInputTracks
        : // Soft aftermath: never backfill peak electronic just to hit pool floors.
          [
            ...retrievalInputTracks,
            ...tracks,
          ].filter((track) => {
            const energy = typeof track.energy === "number" ? track.energy : null;
            return energy != null && energy <= energyHi;
          });
    const backfill = backfillSource
      .filter((track) => !backfillIds.has(track.trackId))
      .slice(0, Math.max(preferredIntentPool, deliveryPoolFloor) - retrievedTracks.length);
    if (backfill.length > 0) {
      retrievedTracks = [...retrievedTracks, ...backfill];
      noteReliabilityFallback(
        energyHi == null ? "intent_pool_retrieval_backfill" : "intent_pool_soft_remnant_backfill",
      );
    }
  }
  let postIntentFilterCountFinal = retrievedTracks.length;
  if (
    opts.hardWorldLock &&
    hardLockVerifiedIds &&
    hardLockVerifiedIds.size > 0 &&
    hardLockVerifiedIds.size < absoluteIntentPoolFloor(targetCount)
  ) {
    // Thin hard-lock worlds: never keep emergency/off-world survivors in the
    // intent pool just because pool size already cleared a lowered floor.
    const verifiedOnly = [...hardLockVerifiedIds]
      .map((trackId) => verifiedTrackById.get(trackId) ?? retrievedTracks.find((track) => track.trackId === trackId))
      .filter((track): track is T => !!track);
    if (verifiedOnly.length > 0) {
      retrievedTracks = verifiedOnly;
      postIntentFilterCountFinal = retrievedTracks.length;
      noteReliabilityFallback(`hard_lock_verified_only_thin_pool_${postIntentFilterCountFinal}`);
    }
  }
  if (isIntentPoolBelowPreferred(postIntentFilterCountFinal, targetCount, effectiveHumanSaveStrict)) {
    noteReliabilityFallback(
      `intent_pool_below_preferred_${postIntentFilterCountFinal}_of_${preferredIntentPool}`,
    );
  }
  if (postIntentFilterCountFinal < deliveryPoolFloor) {
    const verifiedProceedTarget = hardLockVerifiedProceedTarget(
      targetCount,
      hardLockVerifiedIds?.size ?? 0,
    );
    if (
      opts.hardWorldLock &&
      hardLockVerifiedIds &&
      verifiedProceedTarget != null
    ) {
      retrievedTracks = [...hardLockVerifiedIds]
        .map((trackId) => verifiedTrackById.get(trackId))
        .filter((track): track is T => !!track);
      if (retrievedTracks.length < verifiedProceedTarget) {
        for (const row of fullLibraryCollapseTracks) {
          if (retrievedTracks.length >= verifiedProceedTarget) break;
          if (!hardLockVerifiedIds.has(row.trackId)) continue;
          if (retrievedTracks.some((track) => track.trackId === row.trackId)) continue;
          const original = verifiedTrackById.get(row.trackId) ?? (tracks.find((track) => track.trackId === row.trackId) as T | undefined);
          if (!original) continue;
          retrievedTracks.push(original);
        }
      }
      postIntentFilterCountFinal = retrievedTracks.length;
      noteReliabilityFallback(`hard_lock_verified_intent_pool_bypass_${postIntentFilterCountFinal}`);
    } else if (
      opts.hardWorldLock &&
      hardLockVerifiedIds &&
      hardLockVerifiedIds.size > 0
    ) {
      // Thin verified supply (< honest partial min): keep verified-only and never
      // emergency-recover from the broader library (that path re-admits blankets).
      retrievedTracks = [...hardLockVerifiedIds]
        .map((trackId) => verifiedTrackById.get(trackId))
        .filter((track): track is T => !!track);
      postIntentFilterCountFinal = retrievedTracks.length;
      noteReliabilityFallback(`hard_lock_verified_thin_stub_${postIntentFilterCountFinal}`);
    } else {
    const contractCompositionRecovery = opts.deferHumanSaveGateForContractComposition === true;
    const softAftermath =
      !contractCompositionRecovery &&
      (subScenePlan.kind === "soft_electronic_aftermath" ||
      subScenePlan.kind === "soft_focus_concentration");
    const softEnergyHi = softAftermath
      ? (subScenePlan.energyHi ?? subSceneIntentVector.energyRange[1] ?? 0.62)
      : null;
    const salvageSourceRaw = softAftermath
      ? fullLibraryCollapseTracks
      : intentFilterTracks.length > 0
        ? intentFilterTracks
        : retrievalInputTracks.map((track) =>
          enrichIntentCollapseTrack(track, opts.classificationByTrack?.(track.trackId)),
        );
    const salvageSource =
      softEnergyHi == null
        ? salvageSourceRaw
        : salvageSourceRaw.filter((track) => {
          const energy = typeof track.energy === "number" ? track.energy : null;
          return energy != null && energy <= softEnergyHi;
        });
    if (salvageSource.length > 0) {
      const emergencySelection = recoverSamplerUniverse(
        salvageSource,
        { ...subSceneIntentVector, relaxGenreFamilyFilter: true },
        rankedSelection,
        {
          targetCount,
          strictMode: false,
          fingerprintBias,
          ...samplerHardLockOpts,
        },
      );
      const emergencyTracks = emergencySelection.selected.length > 0
        ? emergencySelection.selected
        : salvageSource.slice(0, Math.max(minimumReturnableTrackCount(targetCount), Math.min(targetCount, salvageSource.length)));
      retrievedTracks = emergencyTracks.map((track) => {
        const enriched =
          fullLibraryCollapseTracks.find((row) => row.trackId === track.trackId) ??
          intentFilterTracks.find((row) => row.trackId === track.trackId);
        return {
          ...track,
          genreFamily: enriched?.genreFamily ?? track.genreFamily ?? null,
          genrePrimary: enriched?.genrePrimary ?? track.genrePrimary ?? null,
        };
      }) as T[];
      postIntentFilterCountFinal = retrievedTracks.length;
      noteReliabilityFallback(`intent_pool_emergency_continue_${postIntentFilterCountFinal}`);
    } else if (tracks.length > 0 && !softAftermath) {
      retrievedTracks = tracks.slice(0, Math.max(minimumReturnableTrackCount(targetCount), Math.min(targetCount * 2, tracks.length)));
      postIntentFilterCountFinal = retrievedTracks.length;
      noteReliabilityFallback(`intent_pool_library_emergency_${postIntentFilterCountFinal}`);
    } else if (softAftermath && softEnergyHi != null) {
      const softLibrary = tracks.filter((track) => {
        const energy = typeof track.energy === "number" ? track.energy : null;
        return energy != null && energy <= softEnergyHi;
      });
      if (softLibrary.length > 0) {
        retrievedTracks = softLibrary.slice(
          0,
          Math.max(minimumReturnableTrackCount(targetCount), Math.min(targetCount * 2, softLibrary.length)),
        );
        postIntentFilterCountFinal = retrievedTracks.length;
        noteReliabilityFallback(`intent_pool_soft_library_emergency_${postIntentFilterCountFinal}`);
      } else if (opts.deferHumanSaveGateForContractComposition && tracks.length > 0) {
        retrievedTracks = tracks.slice(
          0,
          Math.max(minimumReturnableTrackCount(targetCount), Math.min(targetCount * 2, tracks.length)),
        );
        postIntentFilterCountFinal = retrievedTracks.length;
        noteReliabilityFallback(`intent_pool_contract_composition_continue_${postIntentFilterCountFinal}`);
      } else {
        const collapseTrace = finalizeExecutionTrace(
          buildIntentCollapseFailureTraceDraft({
            requestId: opts.requestId ?? "unknown",
            prompt: vibe,
            seed: opts.seed ?? null,
            intentCollapseLayer: intentCollapseTrace(),
            preFilterCount: preIntentFilterCount,
            postFilterCount: postIntentFilterCountFinal,
          }),
        );
        throw new IntentCollapseInsufficientPoolError(
          `insufficient_intent_pool:${postIntentFilterCountFinal}<${deliveryPoolFloor}`,
          {
            ...intentCollapseDiagnostics!,
            targetUniverseSize: targetUniverse,
            universeCoverage: postIntentFilterCountFinal / Math.max(1, targetUniverse),
          },
          collapseTrace,
        );
      }
    } else if (opts.deferHumanSaveGateForContractComposition && tracks.length > 0) {
      retrievedTracks = tracks.slice(
        0,
        Math.max(minimumReturnableTrackCount(targetCount), Math.min(targetCount * 2, tracks.length)),
      );
      postIntentFilterCountFinal = retrievedTracks.length;
      noteReliabilityFallback(`intent_pool_contract_composition_continue_${postIntentFilterCountFinal}`);
    } else {
      const collapseTrace = finalizeExecutionTrace(
        buildIntentCollapseFailureTraceDraft({
          requestId: opts.requestId ?? "unknown",
          prompt: vibe,
          seed: opts.seed ?? null,
          intentCollapseLayer: intentCollapseTrace(),
          preFilterCount: preIntentFilterCount,
          postFilterCount: postIntentFilterCountFinal,
        }),
      );
      throw new IntentCollapseInsufficientPoolError(
        `insufficient_intent_pool:${postIntentFilterCountFinal}<${deliveryPoolFloor}`,
        {
          ...intentCollapseDiagnostics!,
          targetUniverseSize: targetUniverse,
          universeCoverage: postIntentFilterCountFinal / Math.max(1, targetUniverse),
        },
        collapseTrace,
      );
    }
    }
  }
  let sceneAnchorRetrievalDiagnostics: ReturnType<
    typeof applySceneAnchorRetrievalQuota<T>
  >["diagnostics"] | null = null;
  {
    const culturalProfileForAnchors = resolveCulturalProfileForCommitted(committedWorld);
    if (culturalProfileForAnchors && retrievedTracks.length > 0 && tracks.length > 0) {
      const anchorQuota = applySceneAnchorRetrievalQuota(
        retrievedTracks,
        tracks,
        culturalProfileForAnchors,
        { prompt: vibe },
      );
      sceneAnchorRetrievalDiagnostics = anchorQuota.diagnostics;
      if (anchorQuota.diagnostics.injected.length > 0) {
        retrievedTracks = anchorQuota.tracks;
        postIntentFilterCountFinal = retrievedTracks.length;
        noteReliabilityFallback(
          `scene_anchor_retrieval_quota_${anchorQuota.diagnostics.injected.length}`,
        );
      }
    }
  }
  activeRetrievalCloud = {
    ...activeRetrievalCloud,
    tracks: (() => {
      const cloudById = new Map(
        activeRetrievalCloud.tracks.map((candidate) => [candidate.track.trackId, candidate]),
      );
      return retrievedTracks.map((track) =>
        cloudById.get(track.trackId) ?? {
          track,
          embeddingAffinity: 0.35,
          retrievalNeighborhood: sceneAnchorRetrievalDiagnostics?.injected.some(
            (row) => row.trackId === track.trackId,
          )
            ? "scene_anchor_quota"
            : "intent_backfill",
          componentAffinities: {
            scene: 0.4,
            taste: 0.45,
            mood: 0.4,
            energy: 0.4,
            drift: 0.35,
          },
        },
      );
    })(),
  };
  const retrievalByTrack = new Map(
    activeRetrievalCloud.tracks.map((candidate) => [candidate.track.trackId, candidate]),
  );
  sceneClusterFunnelCounts.retrieval_dominant_filter = countTracksInDominantSceneCluster(
    retrievedTracks.map((track) => track.trackId),
    preRetrievalSceneWorld,
  );

  const postRetrievalRebuiltWorld = buildSceneWorldContext({
    vibe,
    lockedIntent,
    tracks: retrievedTracks.map((track) => toSceneWorldTrack(track, opts)),
    seed: opts.seed != null ? String(opts.seed) : vibe,
    playlistAdjacency: opts.playlistAdjacency,
    likedAdjacency: opts.likedAdjacency,
  });
  const worldLockedFromFullLibrary = effectiveHumanSaveStrict && !!preRetrievalSceneWorld?.active;
  const sceneWorldContext = worldLockedFromFullLibrary
    ? preRetrievalSceneWorld
    : (postRetrievalRebuiltWorld ?? preRetrievalSceneWorld);
  const sceneWorldStrict = !!sceneWorldContext?.strictMode;
  const sceneWorldProofAcc = opts.sceneWorldProof && sceneWorldContext?.active
    ? createSceneWorldProofAccumulator<T>()
    : null;

  // ── Stage 2: Adaptive lane generation ───────────────────────────────────
  let lanes: ReturnType<typeof buildLanes>;
  let generatorDiagnostics: Record<string, unknown> = {};
  stageStartedAt = Date.now();

  const endLaneGenerationProfile = opts.profileStage?.(
    "v3.laneGeneration",
    fallbackTriggered
      ? "fallback ensemble"
      : intentDecomposer.fallbackSuppressed
        ? "compound anchor lanes"
        : "adaptive",
  );
  const laneGeneration = await safeStage<{
    lanes: ReturnType<typeof buildLanes>;
    diagnostics: Record<string, unknown>;
  }>({
    stage: "v3.laneGeneration",
    type: "SYSTEM_FAILURE",
    requestId: opts.requestId,
    trace: opts.pipelineTrace,
    run: () => {
      if (fallbackTriggered || healthState === "CRITICAL") {
        return {
          lanes: buildLanes(decomposed, { vibe, lockedIntent }),
          diagnostics: {
            mode: "fallback_ensemble",
            reason: fallbackTriggered ? "unclear_intent" : "critical_health",
            intentDecomposer,
          },
        };
      }
      // Compound genre+era+activity prompts: keep standard/adjacent genre lanes
      // instead of rock-biased unclear fallback or sparse-force adaptive routing.
      if (intentDecomposer.fallbackSuppressed) {
        return {
          lanes: buildLanes(decomposed, { vibe, lockedIntent }),
          diagnostics: {
            mode: "compound_anchor_lanes",
            reason: intentDecomposer.fallbackReason,
            intentDecomposer,
            activeLaneTypes: ["core", "emotional", "motion", "contrast"],
          },
        };
      }
      const genResult = generateAdaptiveLanes(decomposed, {
        dominantEmotionExplicit: effectiveIntentGates?.dominantEmotionExplicit,
        allowContrastLanes: effectiveIntentGates?.allowContrastLanes,
        allowExplorationLanes: effectiveIntentGates?.allowExplorationLanes,
      });
      return {
        lanes: genResult.lanes,
        diagnostics: {
          mode: "adaptive",
          activeLaneTypes: genResult.activeLaneTypes,
          intentDecomposer,
          ...genResult.generatorDiagnostics,
        },
      };
    },
    recover: () => ({
      lanes: buildLanes(decomposed, { vibe, lockedIntent }),
      diagnostics: {
        mode: intentDecomposer.fallbackSuppressed ? "compound_anchor_lanes" : "fallback_ensemble",
        reason: "lane_generation_failure",
        intentDecomposer,
      },
    }),
  });
  endLaneGenerationProfile?.();
  lanes = laneGeneration.lanes;
  generatorDiagnostics = laneGeneration.diagnostics;
  recordTiming("laneGeneration", stageStartedAt);

  // ── Stage 3 + 4 + 5: Per-lane scoring → cluster formation → cluster selection ──
  const laneDetails: Array<{
    laneId: string;
    type: string;
    label: string;
    weight: number;
    scoredCount: number;
    strictCandidateCount: number;
    relaxedCandidateCount: number;
    retrievalStrictness: RetrievalStrictness;
    selectedCount: number;
    clusterSpread: Record<string, number>;
    clusterSelectionRatios: Record<string, number>;
    dominantCluster?: string | null;
    clusterPurity?: number;
    secondaryClusterAllowed?: boolean;
    secondaryClusterReason?: string | null;
  }> = [];

  // Observability: per-track decision trace (top 15 by raw score per lane)
  const finalDecisionTrace: Array<{
    trackId: string;
    lane?: string;
    enteredLane: string;
    laneScore: number;
    rawLaneScore: number;
    diversityPenalty: number;
    artistMemoryPenalty: number;
    recentTrackPenalty: number;
    trackReusePenalty: number;
    clusterSaturationPenalty: number;
    familySaturationPenalty: number;
    diversityMultiplier: number;
    artistGravity: number;
    clusterId: string | null;
    clusterWeight?: number | null;
    selected: boolean;
    selectionReason?: string | null;
    rejectionReason: string | null;
  }> = [];
  const recommendationEngineDiagnostics: Array<{
    laneId: string;
    signalCount: number;
    weights: Record<string, number>;
    topDecisions: unknown[];
  }> = [];

  const sampledResults: SampledLaneResult<T>[] = [];
  let samplerOutputCount = 0;
  const laneRetryArtifacts: Array<{
    lane: (typeof lanes)[number];
    clusteredPool: ClusteredPool<T>;
    laneTarget: number;
  }> = [];
  const scoredLaneIds = new Set<string>();
  for (const lane of lanes) {
    await yieldV3();
    if (scoredLaneIds.has(lane.id)) {
      log.error(
        { requestId: opts.requestId, stage: `v3.scoring.${lane.id}`, callStackTag: "v3.laneLoop" },
        "DUPLICATE_EXECUTION_DETECTED",
      );
      recordTraceFailure(opts.pipelineTrace, createFailureContext({
        stage: `v3.scoring.${lane.id}`,
        error: new Error(`Duplicate V3 lane scoring blocked for ${lane.id}`),
        recoverable: true,
      }));
      continue;
    }
    scoredLaneIds.add(lane.id);
    // Stage 3: Score every track for this lane
    let laneStageStartedAt = Date.now();
    const endLaneScoringProfile = opts.profileStage?.(`v3.scoring.${lane.id}`, `${retrievedTracks.length} retrieved tracks`);
    const rawScored = await safeStage<Array<LaneScoredTrack<T>>>({
      stage: `v3.scoring.${lane.id}`,
      type: "SCORING_FAILURE",
      requestId: opts.requestId,
      trace: opts.pipelineTrace,
      run: () => scoreLane(retrievedTracks, lane, decomposed, {
        genreByTrack: opts.genreByTrack,
        noveltyByTrack: opts.noveltyByTrack,
        prototypeBoostByTrack: (trackId) => {
          const track = retrievedTracks.find((row) => row.trackId === trackId);
          const artistName = (track as { artistName?: string | null } | undefined)?.artistName ?? "";
          const proto = prototypeCentreScoreBoost(artistName, genrePrototypeCentres, inferredWorldIds);
          const eco = Math.min(
            0.06,
            artistEcosystemBoost(artistName, opts.artistEcosystemGraph, genrePrototypeCentres.flatMap((c) => c.artists).slice(0, 8)),
          );
          return Math.min(0.1, proto + eco);
        },
      }),
      recover: () => passThroughScored(retrievedTracks, lane.id),
    });
    recordTraceCount(opts.pipelineTrace, `v3.${lane.id}.scored`, rawScored.length);

    const scoredDecisions = rawScored.map((item) => createTrackDecision(item, lane.id));
    forensicTrace.push(stageTrace(
      `decision creation count:${lane.id}`,
      rawScored.length,
      scoredDecisions.length,
      scoredDecisions.length < rawScored.length ? { decision_creation_failed: rawScored.length - scoredDecisions.length } : {},
      "backend/core/v3/track-decision.ts",
      "createTrackDecision",
    ));
    const laneMinPoolSize = Math.max(
      8,
      Math.min(24, Math.ceil(targetCount * Math.max(0.5, lane.weight * 2))),
    );
    const laneReadyDecisions = scoredDecisions.filter((decision) =>
      decisionIsLaneReady(decision, {
        classificationByTrack: opts.classificationByTrack,
      })
    );
    forensicTrace.push(stageTrace(
      `lane readiness count:${lane.id}`,
      scoredDecisions.length,
      laneReadyDecisions.length,
      countReasons(scoredDecisions, (decision) => laneReadinessRejectionReason(decision, {
        classificationByTrack: opts.classificationByTrack,
      })),
      "backend/core/v3/v3-pipeline.ts",
      "decisionIsLaneReady",
    ));
    const constraintReadyDecisions = laneReadyDecisions.filter((decision) =>
      decisionMatchesConstraints(decision, lockedIntent, {
        classificationByTrack: opts.classificationByTrack,
      })
    );
    forensicTrace.push(stageTrace(
      `constraint filter count:${lane.id}`,
      laneReadyDecisions.length,
      constraintReadyDecisions.length,
      countReasons(laneReadyDecisions, (decision) => constraintRejectionReason(decision, lockedIntent, {
        classificationByTrack: opts.classificationByTrack,
      })),
      "backend/core/v3/constraint-filter.ts",
      "trackMatchesConstraints",
    ));
    const strictDecisions = scoredDecisions
      .map((decision) => withDecisionValidity(
        decision,
        decisionMatchesRelaxationLevel(decision, lockedIntent, "strict", {
          classificationByTrack: opts.classificationByTrack,
        })
      ))
      .filter((decision) => decision.valid);
    const initialRelaxationLevel = getRelaxationLevel(strictDecisions.length, laneMinPoolSize);
    let appliedRelaxationLevel: RetrievalStrictness = initialRelaxationLevel;
    let validDecisions = strictDecisions;
    if (strictDecisions.length < laneMinPoolSize) {
      for (const level of RETRIEVAL_RELAXATION_LADDER.slice(1)) {
        const relaxedDecisions = scoredDecisions
          .map((decision) => withDecisionValidity(
            decision,
            decisionMatchesRelaxationLevel(decision, lockedIntent, level, {
              classificationByTrack: opts.classificationByTrack,
            })
          ))
          .filter((decision) => decision.valid)
          .sort((a, b) => b.embeddingAffinity - a.embeddingAffinity);
        validDecisions = relaxedDecisions;
        appliedRelaxationLevel = level;
        if (validDecisions.length >= laneMinPoolSize || level === "fallback_explore") break;
      }
    }
    const affinityDecisions = attachHierarchicalAffinities(validDecisions, lockedIntent, {
      noveltyByTrack: opts.noveltyByTrack,
      classificationByTrack: opts.classificationByTrack,
      retrievalByTrack,
      sessionArtistMemory: opts.sessionArtistMemory,
      trackReusePenalty: opts.trackReusePenalty,
      maxTastePullWeight: effectiveIntentGates?.maxTasteWeight,
    });
    const engineResult = await safeStage<ReturnType<typeof runRecommendationEngine<T>>>({
      stage: `v3.recommendation.${lane.id}`,
      type: "SCORING_FAILURE",
      requestId: opts.requestId,
      trace: opts.pipelineTrace,
      run: () => runRecommendationEngine({
        decisions: affinityDecisions,
        unifiedIntent: unifiedIntentContext.unifiedIntent,
        memory: opts.momentMemory,
        classificationByTrack: opts.classificationByTrack,
        maxTastePullWeight: effectiveIntentGates?.maxTasteWeight,
      }),
      recover: () => ({
        decisions: affinityDecisions.map((decision) => withDecisionFinalScore(decision, decision.score)),
        scores: affinityDecisions.map((decision) => ({
          trackId: decision.track.trackId,
          finalScore: decision.score,
          normalizedSignals: {
            trackId: decision.track.trackId,
            embeddingAffinity: 0,
            sceneAffinity: 0,
            tasteAffinity: 0,
            memoryAffinity: 0,
            freshnessScore: 0,
            repetitionPressure: 0,
            genreAlignment: 0,
            normalizedEmbedding: 0,
            normalizedScene: 0,
            normalizedTaste: 0,
            normalizedMemory: 0,
            normalizedFreshness: 0,
            normalizedRepetition: 0,
            normalizedGenre: 0,
          },
        })),
        diagnostics: {
          signalCount: 0,
          weights: {},
          topDecisions: [],
        },
      }),
    });
    recordTiming("scoring", laneStageStartedAt);
    endLaneScoringProfile?.();
    if (fullDiagnostics) {
      recommendationEngineDiagnostics.push({
        laneId: lane.id,
        signalCount: engineResult.diagnostics.signalCount,
        weights: engineResult.diagnostics.weights,
        topDecisions: engineResult.diagnostics.topDecisions,
      });
    }
    await yieldV3();

    const worldScoredDecisions = sceneWorldContext?.active
      ? engineResult.decisions
        .map((decision) => {
          const worldTrack = {
            trackId: decision.track.trackId,
            artistName: decision.track.artistName,
            genrePrimary: decision.genrePrimary,
            genreFamily: opts.classificationByTrack?.(decision.track.trackId)?.genreFamily ?? null,
            energy: decision.track.energy,
            valence: decision.track.valence,
            danceability: decision.track.danceability,
            acousticness: decision.track.acousticness,
            tempo: decision.track.tempo,
            speechiness: decision.track.speechiness,
          };
          const membership = computeWorldMembershipScore(worldTrack, sceneWorldContext);
          const clusterMembership = computeSceneClusterMembershipScore(worldTrack, sceneWorldContext);
          const clusterReject = shouldRejectForSceneCluster(worldTrack, sceneWorldContext);
          if (sceneWorldProofAcc) {
            const genreFamily = opts.classificationByTrack?.(decision.track.trackId)?.genreFamily
              ?? decision.genrePrimary
              ?? "unknown";
            const beforeScore = decision.finalScore || decision.score;
            recordSceneWorldProofBefore(
              sceneWorldProofAcc,
              decision.track,
              beforeScore,
              genreFamily,
              null,
            );
            if (membership < 0.26 || clusterReject) {
              recordSceneWorldMembershipRemoval(
                sceneWorldProofAcc,
                decision.track,
                rankBeforeMembershipFilter(sceneWorldProofAcc, decision.track.trackId),
                clusterReject ? clusterMembership : membership,
                sceneWorldContext,
                clusterReject
                  ? describeSceneClusterViolation(worldTrack, sceneWorldContext)
                  : undefined,
              );
            }
          }
          if (membership < 0.26 || clusterReject) {
            return withDecisionFinalScore(decision, 0);
          }
          const combinedMembership = clamp01(membership * 0.52 + clusterMembership * 0.48);
          const blended = blendScoreWithWorldMembership(
            decision.finalScore || decision.score,
            combinedMembership,
            sceneWorldContext.strictMode,
          );
          if (sceneWorldProofAcc) {
            const genreFamily = opts.classificationByTrack?.(decision.track.trackId)?.genreFamily
              ?? decision.genrePrimary
              ?? "unknown";
            recordSceneWorldProofAfter(
              sceneWorldProofAcc,
              decision.track,
              blended,
              genreFamily,
              combinedMembership,
              clusterMembership,
            );
          }
          return withDecisionFinalScore(decision, blended);
        })
        .filter((decision) => {
          if (decision.finalScore <= 0.04) return false;
          if (!humanSaveStrictMode || strictPrimaryFamilies.size === 0) return true;
          const family = resolvedDecisionGenreFamily(decision, {
            classificationByTrack: opts.classificationByTrack,
          });
          return !!family && strictPrimaryFamilies.has(family.toLowerCase());
        })
        .sort((a, b) => b.finalScore - a.finalScore)
      : engineResult.decisions;

    if (sceneWorldContext?.sceneClusters) {
      const dominantId = sceneWorldContext.sceneClusters.dominantClusterId;
      let worldLayerDominant = 0;
      let primaryFamilyDominant = 0;
      for (const decision of engineResult.decisions) {
        const worldTrack = toSceneWorldTrack(decision.track, opts);
        const sceneClusterId = sceneWorldContext.sceneClusters.trackToClusterId.get(decision.track.trackId);
        if (sceneClusterId !== dominantId) continue;
        const membership = computeWorldMembershipScore(worldTrack, sceneWorldContext);
        const clusterReject = shouldRejectForSceneCluster(worldTrack, sceneWorldContext);
        if (membership >= 0.26 && !clusterReject) {
          worldLayerDominant++;
          if (!humanSaveStrictMode || strictPrimaryFamilies.size === 0) {
            primaryFamilyDominant++;
          } else {
            const family = resolvedDecisionGenreFamily(decision, {
              classificationByTrack: opts.classificationByTrack,
            });
            if (family && strictPrimaryFamilies.has(family.toLowerCase())) {
              primaryFamilyDominant++;
            }
          }
        }
      }
      sceneClusterFunnelCounts.world_layer = Math.max(sceneClusterFunnelCounts.world_layer, worldLayerDominant);
      sceneClusterFunnelCounts.primary_family = Math.max(sceneClusterFunnelCounts.primary_family, primaryFamilyDominant);
    }

    // Headroom: 3× target so the sampler has enough valid choices.
    const laneTarget = Math.max(
      Math.ceil(targetCount * lane.weight * 3),
      Math.ceil(targetCount * lane.weight) + 10,
    );

    // Stage 4: Build clusters from scored pool
    laneStageStartedAt = Date.now();
    const endLaneClusteringProfile = opts.profileStage?.(`v3.clustering.${lane.id}`, `${worldScoredDecisions.length} decisions`);
    let clusteredPool = overloaded
      ? flatClusteredPool(worldScoredDecisions, lane.id)
      : await safeStage<ClusteredPool<T>>({
          stage: `v3.clustering.${lane.id}`,
          type: "CLUSTERING_FAILURE",
          requestId: opts.requestId,
          trace: opts.pipelineTrace,
          run: () => buildClusters(worldScoredDecisions),
          recover: () => flatClusteredPool(worldScoredDecisions, lane.id),
        });
    if (humanSaveStrictMode && sceneWorldContext?.sceneClusters) {
      const dominantClusterId = sceneWorldContext.sceneClusters.dominantClusterId;
      const strictClusteredTracks = clusteredPool.scoredTracks.filter((decision) => {
        const family = resolvedDecisionGenreFamily(decision, {
          classificationByTrack: opts.classificationByTrack,
        });
        if (strictPrimaryFamilies.size > 0 && (!family || !strictPrimaryFamilies.has(family.toLowerCase()))) {
          return false;
        }
        const sceneClusterId = sceneWorldContext.sceneClusters!.trackToClusterId.get(decision.track.trackId);
        if (sceneClusterId !== dominantClusterId) return false;
        return computeSceneClusterMembershipScore(decision.track, sceneWorldContext) >= 0.80;
      });
      sceneClusterFunnelCounts.strict_cluster_filter = Math.max(
        sceneClusterFunnelCounts.strict_cluster_filter,
        strictClusteredTracks.length,
      );
      if (strictClusteredTracks.length > 0) {
        clusteredPool = {
          ...clusteredPool,
          scoredTracks: strictClusteredTracks,
        };
      }
    }
    if (overloaded) recordTraceFallback(opts.pipelineTrace, `v3.clustering.${lane.id}.bypassed_overload`);
    recordTiming("candidateGeneration", laneStageStartedAt);
    endLaneClusteringProfile?.();
    recordTraceCount(opts.pipelineTrace, `v3.${lane.id}.clusters`, clusteredPool.clusters.size);
    await yieldV3();
    forensicTrace.push(stageTrace(
      `cluster creation count:${lane.id}`,
      engineResult.decisions.length,
      clusteredPool.scoredTracks.length,
      clusteredPool.scoredTracks.length < engineResult.decisions.length ? { cluster_creation_drop: engineResult.decisions.length - clusteredPool.scoredTracks.length } : {},
      "backend/core/v3/cluster-candidate-engine.ts",
      "buildClusters",
    ));

    laneRetryArtifacts.push({ lane, clusteredPool, laneTarget });

    // Stage 5: Entropy-constrained selection across clusters
    laneStageStartedAt = Date.now();
    const endLaneSamplingProfile = opts.profileStage?.(`v3.sampling.${lane.id}`, `${clusteredPool.scoredTracks.length} clustered tracks`);
    const clusterResult = await safeStage<ReturnType<typeof selectFromClusters<T>>>({
      stage: `v3.sampling.${lane.id}`,
      type: "SYSTEM_FAILURE",
      requestId: opts.requestId,
      trace: opts.pipelineTrace,
      run: () => selectFromClusters(
        clusteredPool,
        laneTarget,
        lane.id,
        `${opts.seed ?? "v3"}:${lane.id}`,
        {
          lockedIntent,
          sessionArtistMemory: opts.sessionArtistMemory,
          recentTrackPenalty: opts.trackReusePenalty,
          sceneWorld: sceneWorldContext,
          interpretation: opts.samplerInterpretation,
        },
      ),
      recover: () => topNSelection(clusteredPool.scoredTracks, lane.id, laneTarget),
    });
    recordTiming("sampler", laneStageStartedAt);
    endLaneSamplingProfile?.();
    recordTraceCount(opts.pipelineTrace, `v3.${lane.id}.sampled`, clusterResult.tracks.length);
    await yieldV3();
    sceneClusterFunnelCounts.sampler_pool += clusterResult.tracks.length;
    samplerOutputCount += clusterResult.tracks.length;
    forensicTrace.push(stageTrace(
      `sampler input count:${lane.id}`,
      clusteredPool.scoredTracks.length,
      clusterResult.tracks.length,
      clusterResult.samplerDiagnostics.rejectionReasons,
      "backend/core/v3/v3-sampler.ts",
      "selectFromClusters",
    ));

    if (fullDiagnostics) {
      // ── Observability: build per-track trace (top 15 by raw score) ─────────
      const selectedIdSet = new Set(clusterResult.tracks.map((t) => t.trackId));
      const rawScoreMap = new Map(rawScored.map((r) => [r.track.trackId, r.laneScore]));
      const engineDecisionByTrack = new Map(engineResult.decisions.map((decision) => [decision.track.trackId, decision]));

      const traceEntries = [...rawScored]
        .sort((a, b) => (rawScoreMap.get(b.track.trackId) ?? 0) - (rawScoreMap.get(a.track.trackId) ?? 0))
        .slice(0, 15)
        .map((item) => {
          const rawScore = rawScoreMap.get(item.track.trackId) ?? item.laneScore;
          const sel = selectedIdSet.has(item.track.trackId);
          const selTrack = sel ? clusterResult.tracks.find((t) => t.trackId === item.track.trackId) : undefined;
          const engineDecision = engineDecisionByTrack.get(item.track.trackId);
          const decisionDiversity = (selTrack?.diversity ?? engineDecision?.diversity ?? emptyDiversityTraceComponents()) as DiversityTraceComponents;
          const selectedScore = selTrack?.laneScore ?? engineDecision?.finalScore ?? item.laneScore;
          const selectionReason = sel ? "sampler_selected" : null;

          return {
            trackId: item.track.trackId,
            lane: lane.id,
            enteredLane: lane.id,
            laneScore: Math.round(selectedScore * 1000) / 1000,
            rawLaneScore: Math.round(rawScore * 1000) / 1000,
            diversityPenalty: decisionDiversity.totalPenalty,
            artistMemoryPenalty: decisionDiversity.artistMemoryPenalty,
            recentTrackPenalty: decisionDiversity.recentTrackPenalty,
            trackReusePenalty: decisionDiversity.trackReusePenalty,
            clusterSaturationPenalty: decisionDiversity.clusterSaturationPenalty,
            familySaturationPenalty: decisionDiversity.familySaturationPenalty,
            diversityMultiplier: decisionDiversity.finalMultiplier,
            artistGravity: decisionDiversity.artistGravity,
            clusterId: selTrack?.clusterIds[0] ?? null,
            clusterWeight: selTrack ? (clusterResult.clusterSelectionRatios[selTrack.clusterIds[0] ?? ""] ?? null) : null,
            selected: sel,
            selectionReason,
            rejectionReason: sel ? null : "cluster_entropy_cap",
          };
        });

      finalDecisionTrace.push(...traceEntries);
    }

    laneDetails.push({
      laneId: lane.id,
      type: lane.type,
      label: lane.label,
      weight: lane.weight,
      scoredCount: rawScored.length,
      strictCandidateCount: strictDecisions.length,
      relaxedCandidateCount: validDecisions.length,
      retrievalStrictness: appliedRelaxationLevel,
      selectedCount: clusterResult.tracks.length,
      clusterSpread: clusterResult.clusterSpread as unknown as Record<string, number>,
      clusterSelectionRatios: clusterResult.clusterSelectionRatios,
      dominantCluster: clusterResult.samplerDiagnostics.dominantCluster,
      clusterPurity: clusterResult.samplerDiagnostics.clusterPurity,
      secondaryClusterAllowed: clusterResult.samplerDiagnostics.secondaryClusterAllowed,
      secondaryClusterReason: clusterResult.samplerDiagnostics.secondaryClusterReason,
    });

    sampledResults.push({
      laneId: lane.id,
      tracks: clusterResult.tracks,
    });
  }

  const preferredOpeningSize = humanSaveStrictMode ? 10 : 5;
  const openingEditorialLock = reinforceOpeningEditorialWorldLock({
    sampledLanes: sampledResults,
    intent: activeEditorialIntentVector,
    openingSize: preferredOpeningSize,
    hardWorldLock: opts.hardWorldLock,
    worldVerifiedIds: hardLockVerifiedIds,
  });
  if (openingEditorialLock.relaxed) {
    noteReliabilityFallback(
      `opening_editorial_lock_effective_${openingEditorialLock.effectiveOpeningSize}_of_${openingEditorialLock.preferredOpeningSize}`,
    );
  } else if (openingEditorialLock.effectiveOpeningSize === 0) {
    noteReliabilityFallback("opening_editorial_lock_no_eligible_used_unfiltered_lanes");
  }
  if (openingEditorialLock.openingEligibleCount >= 1) {
    sampledResults.splice(0, sampledResults.length, ...openingEditorialLock.sampledLanes);
  }

  // ── Stage 7: Adaptive cluster-aware interleaving ─────────────────────────
  const interleaverInputCount = sampledResults.reduce((sum, lane) => sum + lane.tracks.length, 0);
  const culturalProfileForCompose = resolveCulturalProfileForCommitted(committedWorld);
  const hardLockCompose = opts.hardWorldLock === true || committedWorld?.hardLock === true;
  const composeTarget = purityAwareComposeTarget(targetCount, {
    hardLock: hardLockCompose,
    candidatePoolSize: postIntentFilterCountFinal,
    sampleTracks: tracks.slice(0, 50).map((t) => ({
      trackName: t.trackName,
      artistName: t.artistName,
      genreFamily: t.genreFamily,
      genrePrimary: t.genrePrimary,
      spotifyArtistGenres: (t as { spotifyArtistGenres?: unknown }).spotifyArtistGenres,
      energy: t.energy,
      releaseYear: (t as { releaseYear?: number | null }).releaseYear,
    })),
    profile: culturalProfileForCompose,
  });
  stageStartedAt = Date.now();
  const endInterleaverProfile = opts.profileStage?.("v3.interleaver", `${interleaverInputCount} sampled tracks`);
  const cohesivePlaylist = lockedIntent.genreFamilies.length === 0 && !lockedIntent.eraRange;
  const interleaved = await safeStage<InterleavedResult<T>>({
    stage: "v3.interleaver",
    type: "SYSTEM_FAILURE",
    requestId: opts.requestId,
    trace: opts.pipelineTrace,
    run: () => interleaveLanes(lanes, sampledResults, composeTarget, {
      cohesivePlaylist: cohesivePlaylist || humanSaveStrictMode,
      sceneWorld: sceneWorldContext,
      strictOpeningCluster: false,
    }),
    recover: () => ({
      tracks: sampledResults.flatMap((lane) => lane.tracks).slice(0, composeTarget),
      laneContributions: Object.fromEntries(sampledResults.map((lane) => [lane.laneId, lane.tracks.length])),
      interleaverDiagnostics: {
        repetitionEvents: 0,
        chaosEvents: 0,
        monotonyEvents: 0,
        laneBoostEvents: {},
        finalLaneUsageRatios: {},
        entropyAtCompletion: 0,
      },
    }),
  });
  recordTiming("interleaver", stageStartedAt);
  endInterleaverProfile?.();
  const preInterleaverPreview = sampledResults
    .flatMap((lane) => lane.tracks)
    .sort((a, b) => b.laneScore - a.laneScore)
    .slice(0, 10)
    .map((track) => ({
      ...track,
      clusterId: track.clusterIds[0],
    })) as Array<T & V3SelectionCandidate<T>>;
  const strictOpeningCount = openingEditorialLock.effectiveOpeningSize > 0
    ? openingEditorialLock.effectiveOpeningSize
    : preferredOpeningSize;
  const preInterleaverOpeningAudit = openingClusterAudit(preInterleaverPreview, sceneWorldContext, strictOpeningCount);
  forensicTrace.push(stageTrace(
    "interleaver input count",
    interleaverInputCount,
    interleaved.tracks.length,
    interleaverInputCount > interleaved.tracks.length
      ? { interleaver_target_cap_or_duplicate: interleaverInputCount - interleaved.tracks.length }
      : {},
    "backend/core/v3/interleaver.ts",
    "interleaveLanes",
  ));
  let finalTracks = interleaved.tracks.map((track) => ({
    ...track,
    clusterId: track.clusterIds[0],
  })) as Array<T & V3SelectionCandidate<T>>;
  if (opts.hardWorldLock && hardLockVerifiedIds && hardLockVerifiedIds.size > 0) {
    const salvaged = salvageHardLockVerifiedTracks(
      finalTracks,
      tracks,
      hardLockVerifiedIds,
      targetCount,
    ) as Array<T & V3SelectionCandidate<T>>;
    if (salvaged.length > finalTracks.length) {
      finalTracks = salvaged.map((track) => ({
        ...track,
        clusterId: (track as { clusterIds?: string[] }).clusterIds?.[0] ?? track.clusterId ?? null,
      })) as Array<T & V3SelectionCandidate<T>>;
      noteReliabilityFallback(`hard_lock_verified_compose_salvage_${finalTracks.length}`);
    }
  }
  const postInterleaverOnlyAudit = openingClusterAudit(finalTracks, sceneWorldContext, strictOpeningCount);
  const toPatternTrack = (track: T & V3SelectionCandidate<T>) => ({
    trackId: track.trackId,
    artistName: track.artistName,
    energy: track.energy,
    valence: track.valence,
    danceability: track.danceability,
    acousticness: track.acousticness,
    popularity: (track as { popularity?: number | null }).popularity ?? null,
    rediscoveryScore: (track as { rediscoveryScore?: number | null }).rediscoveryScore ?? null,
    releaseYear: (track as { releaseYear?: number | null }).releaseYear ?? null,
    tempo: (track as { tempo?: number | null }).tempo ?? null,
    genreFamily: track.genreFamily ?? null,
    genrePrimary: track.genrePrimary ?? null,
    laneScore: track.laneScore,
  });
  const curationScoringContext: PlaylistCurationScoringContext = {
    prompt: vibe,
    lockedIntent,
    context: sceneWorldContext ?? null,
    libraryFingerprint: opts.libraryFingerprint ?? null,
    targetLength: finalTracks.length,
  };
  if (finalTracks.length > 0 && isGenuinelyUsablePlaylist(finalTracks.length, targetCount)) {
    opts.onGoodPlaylistReady?.({
      tracks: finalTracks.map(toPatternTrack),
      deliverableTracks: finalTracks.map((track) => ({ ...track })),
      scoringContext: {
        ...curationScoringContext,
        targetLength: targetCount,
      },
    });
  }
  const maxSearchPoolTracks = humanSaveStrictMode ? 112 : 96;
  const searchPool = (() => {
    const seen = new Set<string>();
    const out: Array<T & V3SelectionCandidate<T>> = [];
    for (const track of [...retrievedTracks, ...finalTracks]) {
      if (seen.has(track.trackId)) continue;
      seen.add(track.trackId);
      out.push(track as T & V3SelectionCandidate<T>);
    }
    return out.map(toPatternTrack);
  })();
  // Hard-lock can union 9k+ verified tracks into retrieval; cap local-search /
  // editorial candidate pools to the same bound as complete-playlist search.
  const cappedSearchPool = searchPool.slice(0, maxSearchPoolTracks);
  const completePlaylistSearch = (() => {
    if (opts.shouldSkipMarginalImprovement?.()) {
      return {
        tracks: finalTracks.map(toPatternTrack),
        selectedStrategy: "skipped_latency_budget" as const,
        candidatesExplored: 0,
        beamWidth: 0,
        scoreBefore: 0,
        scoreAfter: 0,
        candidateScores: [] as number[],
        constraintsRelaxed: [] as string[],
      };
    }
    const completeSearchStartedAt = Date.now();
    const result = searchOptimalCompletePlaylist({
      seedPlaylist: finalTracks.map(toPatternTrack),
      pool: searchPool,
      targetLength: finalTracks.length,
      beamWidth: humanSaveStrictMode ? 6 : 5,
      maxPoolTracks: humanSaveStrictMode ? 112 : 96,
      seed: `${opts.seed ?? vibe}:complete`,
      scoringContext: curationScoringContext,
    });
    recordTiming("completeSearch", completeSearchStartedAt);
    return result;
  })();
  {
    const byId = new Map<string, (typeof finalTracks)[number]>();
    for (const track of finalTracks) byId.set(track.trackId, track);
    for (const track of retrievedTracks) {
      if (!byId.has(track.trackId)) {
        byId.set(track.trackId, {
          ...track,
          clusterId: (track as { clusterIds?: string[] }).clusterIds?.[0] ?? null,
        } as (typeof finalTracks)[number]);
      }
    }
    const searched = completePlaylistSearch.tracks
      .map((track) => byId.get(track.trackId))
      .filter((track): track is (typeof finalTracks)[number] => !!track);
    if (searched.length >= Math.max(8, Math.floor(finalTracks.length * 0.75))) {
      finalTracks = searched;
    }
  }
  const localSearchPool = cappedSearchPool;
  const localSearch = (() => {
    if (opts.shouldSkipMarginalImprovement?.()) {
      return {
        tracks: finalTracks.map(toPatternTrack),
        moves: [],
        scoreBefore: 0,
        scoreAfter: 0,
      };
    }
    const localSearchStartedAt = Date.now();
    const result = improvePlaylistByLocalSearch(
      finalTracks.map(toPatternTrack),
      localSearchPool,
      {
        maxIterations: humanSaveStrictMode ? 64 : 48,
        seed: opts.requestId ?? vibe,
        scoringContext: curationScoringContext,
        preferWorldDensity: true,
      },
    );
    recordTiming("localSearch", localSearchStartedAt);
    return result;
  })();
  if (localSearch.moves.length > 0 && localSearch.scoreAfter >= localSearch.scoreBefore - 0.0005) {
    const byId = new Map<string, (typeof finalTracks)[number]>();
    for (const track of finalTracks) byId.set(track.trackId, track);
    for (const track of retrievedTracks) {
      if (!byId.has(track.trackId)) {
        byId.set(track.trackId, {
          ...track,
          clusterId: (track as { clusterIds?: string[] }).clusterIds?.[0] ?? null,
        } as (typeof finalTracks)[number]);
      }
    }
    const mapped = localSearch.tracks
      .map((track) => byId.get(track.trackId))
      .filter((track): track is (typeof finalTracks)[number] => !!track);
    if (mapped.length >= Math.max(8, Math.floor(finalTracks.length * 0.75))) {
      finalTracks = mapped;
    }
  }
  const openingRepairCount = 0;
  const insufficientOpeningWorldReason: string | null = null;
  const postInterleaverOpeningAudit = openingClusterAudit(finalTracks, sceneWorldContext, strictOpeningCount);
  const openingTenTrace = humanSaveStrictMode && sceneWorldContext?.sceneClusters
    ? finalTracks.slice(0, 10).map((track, idx) => {
      const inPool = sampledResults
        .flatMap((lane) => lane.tracks)
        .some((candidate) => candidate.trackId === track.trackId);
      const sourceLane = sampledResults.find((lane) =>
        lane.tracks.some((candidate) => candidate.trackId === track.trackId),
      )?.laneId ?? track.sourceLane ?? "unknown";
      const dominantClusterId = sceneWorldContext.sceneClusters!.dominantClusterId;
      const sceneClusterId = sceneWorldContext.sceneClusters!.trackToClusterId.get(track.trackId) ?? null;
      return {
        rank: idx + 1,
        trackId: track.trackId,
        artist: track.artistName,
        sourceLane,
        inOpeningCandidatePool: inPool,
        inDominantSceneCluster: trackInDominantSceneCluster(track, sceneWorldContext),
        sceneClusterId,
        dominantClusterId,
        clusterMembership: computeSceneClusterMembershipScore(track, sceneWorldContext),
        selectionReason: inPool ? `sampler_lane:${sourceLane}` : "interleaver_lane_merge",
      };
    })
    : [];
  const openingTenDominantCluster = {
    targetPurity: OPENING_TEN_DOMINANT_CLUSTER_MIN_PURITY,
    preInterleaverSamplerPreviewPurity: openingDominantClusterPurity(preInterleaverPreview, sceneWorldContext, 10),
    postInterleaverPurity: openingDominantClusterPurity(finalTracks, sceneWorldContext, 10),
    interleaver: interleaved.interleaverDiagnostics.openingTenDominantCluster ?? null,
    trace: openingTenTrace,
  };
  const opening5PreInterleaver = sceneWorldContext?.sceneClusters
    ? preInterleaverPreview.filter(
      (track) => sceneWorldContext.sceneClusters!.trackToClusterId.get(track.trackId)
        === sceneWorldContext.sceneClusters!.dominantClusterId,
    ).length
    : 0;
  const opening5PostInterleaver = sceneWorldContext?.sceneClusters
    ? finalTracks.slice(0, 5).filter(
      (track) => sceneWorldContext.sceneClusters!.trackToClusterId.get(track.trackId)
        === sceneWorldContext.sceneClusters!.dominantClusterId,
    ).length
    : 0;
  const sceneClusterFunnel = buildSceneClusterFunnelReport({
    ...sceneClusterFunnelCounts,
    sampler_pool: Math.max(sceneClusterFunnelCounts.sampler_pool, samplerOutputCount),
  }, {
    context: sceneWorldContext,
    preRetrievalContext: preRetrievalSceneWorld,
    postRetrievalRebuiltContext: postRetrievalRebuiltWorld,
    retrievalDominantFilterApplied,
    worldLockedFromFullLibrary,
    opening5PreInterleaver,
    opening5PostInterleaver,
  });
  const interleaverStepPurityDegraded =
    postInterleaverOnlyAudit.openingClusterPurity < preInterleaverOpeningAudit.openingClusterPurity;
  const editorialOpeningPurityDegraded =
    postInterleaverOpeningAudit.openingClusterPurity < postInterleaverOnlyAudit.openingClusterPurity;
  const interleaverPurityDegraded = interleaverStepPurityDegraded;
  if (interleaverStepPurityDegraded) {
    recordTraceFailure(opts.pipelineTrace, createFailureContext({
      stage: "v3.interleaver.audit",
      error: new Error("interleaver_cluster_purity_degraded"),
      recoverable: true,
      requestId: opts.requestId,
    }));
  }
  if (finalTracks.length === 0) {
    const cachedFinalTracks = getFallbackCache<Array<T & V3SelectionCandidate<T>>>(outputCacheKey);
    finalTracks = cachedFinalTracks ?? minimalSelectedTracks(tracks, targetCount);
    if (finalTracks.length > 0) {
      noteReliabilityFallback(cachedFinalTracks ? "v3.output_cache_fallback" : "v3.minimal_output_fallback");
    }
  }
  if (finalTracks.length > 0) setFallbackCache(outputCacheKey, finalTracks);

  let editorialPolishDiagnostics: EditorialLayerDiagnostics | null = null;
  const prePolishTracks = finalTracks;
  const prePolishBelievability = playlistBelievabilityScore(
    prePolishTracks.map(toPatternTrack),
    curationScoringContext,
  );
  if (finalTracks.length > 0 && sceneWorldContext?.active && sceneWorldContext.sceneClusters && !opts.shouldSkipMarginalImprovement?.()) {
    const polish = applyHumanSaveabilityPolishLayer({
      tracks: finalTracks,
      context: sceneWorldContext,
    });
    const polishedBelievability = playlistBelievabilityScore(
      polish.tracks.map(toPatternTrack),
      curationScoringContext,
    );
    if (polishedBelievability >= prePolishBelievability - 0.002) {
      finalTracks = polish.tracks;
      editorialPolishDiagnostics = polish.diagnostics;
    }
  }

  let editorialStabiliserDiagnostics: EditorialStabiliserDiagnostics | null = null;
  const polishMutated = !!editorialPolishDiagnostics &&
    (editorialPolishDiagnostics.swapsPerformed > 0 || editorialPolishDiagnostics.monotonyFixesApplied > 0);
  const preStabiliserTracks = finalTracks;
  const preStabiliserBelievability = playlistBelievabilityScore(
    preStabiliserTracks.map(toPatternTrack),
    curationScoringContext,
  );
  if (
    finalTracks.length > 0 &&
    sceneWorldContext?.active &&
    sceneWorldContext.sceneClusters &&
    (humanSaveStrictMode || polishMutated) &&
    !opts.shouldSkipMarginalImprovement?.()
  ) {
    const stabiliser = applyHumanSaveabilityStabiliser({
      tracks: finalTracks,
      context: sceneWorldContext,
    });
    const stabilisedBelievability = playlistBelievabilityScore(
      stabiliser.tracks.map(toPatternTrack),
      curationScoringContext,
    );
    if (stabilisedBelievability >= preStabiliserBelievability - 0.002) {
      finalTracks = stabiliser.tracks;
      editorialStabiliserDiagnostics = stabiliser.diagnostics;
    }
  }
  const editorialLayersMutated = polishMutated ||
    !!editorialStabiliserDiagnostics?.applied ||
    (editorialStabiliserDiagnostics?.openingSwapsPerformed ?? 0) > 0 ||
    (editorialStabiliserDiagnostics?.arcSwapsPerformed ?? 0) > 0;
  if (editorialLayersMutated && finalTracks.length > 0 && !opts.shouldSkipMarginalImprovement?.()) {
    const refinement = improvePlaylistByLocalSearch(
      finalTracks.map(toPatternTrack),
      localSearchPool,
      {
        maxIterations: humanSaveStrictMode ? 24 : 16,
        seed: `${opts.requestId ?? vibe}:refine`,
        scoringContext: curationScoringContext,
      },
    );
    if (refinement.moves.length > 0 && refinement.scoreAfter >= refinement.scoreBefore - 0.0005) {
      const byId = new Map<string, (typeof finalTracks)[number]>();
      for (const track of finalTracks) byId.set(track.trackId, track);
      for (const track of retrievedTracks) {
        if (!byId.has(track.trackId)) {
          byId.set(track.trackId, {
            ...track,
            clusterId: (track as { clusterIds?: string[] }).clusterIds?.[0] ?? null,
          } as (typeof finalTracks)[number]);
        }
      }
      const mapped = refinement.tracks
        .map((track) => byId.get(track.trackId))
        .filter((track): track is (typeof finalTracks)[number] => !!track);
      if (mapped.length >= Math.max(8, Math.floor(finalTracks.length * 0.75))) {
        finalTracks = mapped;
      }
    }
  }

  let editorialAudit: ReturnType<typeof auditEditorialPlaylist<T>> | null = null;
  let editorialRemoved: Array<{
    title: string;
    artist: string;
    trackId: string;
    previousRank: number;
    worldMembershipScore: number;
    removalReason: string;
  }> = [];

  const gateCandidateIds = new Set(cappedSearchPool.map((track) => track.trackId));
  const gateCandidates = gateCandidateIds.size > 0
    ? (retrievedTracks as unknown as import("../human-saveability-gate").HumanSaveabilityTrack[])
      .filter((track) => gateCandidateIds.has(track.trackId))
    : (retrievedTracks as unknown as import("../human-saveability-gate").HumanSaveabilityTrack[])
      .slice(0, maxSearchPoolTracks);
  const humanSaveGateStartedAt = Date.now();
  const humanSaveGate = await runHumanSaveabilityGateWithRetries({
    prompt: vibe,
    lockedIntent,
    initialTracks: finalTracks as unknown as import("../human-saveability-gate").HumanSaveabilityTrack[],
    candidates: gateCandidates,
    context: sceneWorldContext,
    targetCount,
    strictHumanSave: humanSaveStrictMode,
    laneRetryArtifacts,
    lanes,
    sampledResults,
    seed: opts.seed,
    lockedIntentForSampler: lockedIntent,
    sessionArtistMemory: opts.sessionArtistMemory,
    recentTrackPenalty: opts.trackReusePenalty,
    cohesivePlaylist: cohesivePlaylist || humanSaveStrictMode,
    shouldSkipMarginalImprovement: opts.shouldSkipMarginalImprovement,
  });
  recordTiming("humanSaveability", humanSaveGateStartedAt);
  recordTiming("tournament", humanSaveGateStartedAt);
  finalTracks = humanSaveGate.tracks as Array<T & V3SelectionCandidate<T>>;
  if (opts.hardWorldLock && hardLockVerifiedIds && hardLockVerifiedIds.size > 0) {
    finalTracks = salvageHardLockVerifiedTracks(
      finalTracks,
      tracks,
      hardLockVerifiedIds,
      targetCount,
    ) as Array<T & V3SelectionCandidate<T>>;
  }
  editorialRemoved = humanSaveGate.editorialRemoved;

  let humanSaveabilityDiagnostics: Record<string, unknown> = {
    passed: humanSaveGate.passed,
    humanSaveable: humanSaveGate.evaluation.humanSaveable,
    curatorScore: humanSaveGate.evaluation.curatorScore,
    wouldSaveScore: humanSaveGate.evaluation.wouldSaveScore,
    humanPatternScore: humanSaveGate.evaluation.humanPatternScore,
    breakdown: humanSaveGate.evaluation.breakdown,
    rejectionReasons: humanSaveGate.evaluation.rejectionReasons,
    offendingTracks: humanSaveGate.evaluation.offendingTracks,
    strictModeHumanSaveability: humanSaveGate.evaluation.strictModeHumanSaveability,
    openingClusterPurity: postInterleaverOpeningAudit.openingClusterPurity,
    openingClusterViolations: postInterleaverOpeningAudit.openingClusterViolations,
    openingRepairCount,
    dominantCluster: postInterleaverOpeningAudit.dominantClusterLabel,
    interleaverAudit: {
      preInterleaverOpeningClusterPurity: preInterleaverOpeningAudit.openingClusterPurity,
      postInterleaverOpeningClusterPurity: postInterleaverOpeningAudit.openingClusterPurity,
      postInterleaverOnlyOpeningClusterPurity: postInterleaverOnlyAudit.openingClusterPurity,
      degraded: interleaverPurityDegraded,
      editorialOpeningPurityDegraded,
      failureOrigin: interleaverStepPurityDegraded
        ? "interleaver_step"
        : editorialOpeningPurityDegraded
          ? "editorial_passes"
          : "none",
      insufficientOpeningWorldReason,
    },
    attribution: humanSaveGate.failureAttribution,
    retriesUsed: humanSaveGate.retriesUsed,
    maxRetries: 2,
    hardFailed: !humanSaveGate.passed,
    degradedDelivery: false,
    sceneClusterFunnel,
    openingTenDominantCluster,
    editorialPolishLayer: editorialPolishDiagnostics,
    editorialStabiliserLayer: editorialStabiliserDiagnostics,
    intentCollapseLayer: intentCollapseDiagnostics,
    samplerIntentContext,
    completePlaylistSearch: {
      selectedStrategy: completePlaylistSearch.selectedStrategy,
      candidatesExplored: completePlaylistSearch.candidatesExplored,
      beamWidth: completePlaylistSearch.beamWidth,
      scoreBefore: completePlaylistSearch.scoreBefore,
      scoreAfter: completePlaylistSearch.scoreAfter,
      candidateScores: completePlaylistSearch.candidateScores,
      constraintsRelaxed: completePlaylistSearch.constraintsRelaxed,
    },
    editorialStackSimplified: {
      openingEndingCuratorsRemoved: true,
      openingValidatorsRemoved: true,
      stabiliserSkippedUnlessStrictOrPolishMutated: true,
    },
  };

  const verifiedProceedTarget = hardLockVerifiedProceedTarget(
    targetCount,
    hardLockVerifiedIds?.size ?? 0,
  );
  const honestPartialCap = Math.min(12, Math.ceil(targetCount * 0.4));
  const gateWouldHardFail = !humanSaveGate.passed;
  if (gateWouldHardFail) {
    if (opts.hardWorldLock && hardLockVerifiedIds && hardLockVerifiedIds.size > 0) {
      finalTracks = finalTracks.filter((track) => hardLockVerifiedIds.has(track.trackId)) as Array<
        T & V3SelectionCandidate<T>
      >;
      finalTracks = salvageHardLockVerifiedTracks(
        finalTracks,
        tracks,
        hardLockVerifiedIds,
        honestPartialCap,
      ) as Array<T & V3SelectionCandidate<T>>;
    } else {
      finalTracks = finalTracks.slice(0, honestPartialCap) as Array<T & V3SelectionCandidate<T>>;
    }
    // Human Curation Alignment v2: never pad a failed identity into a full-length
    // "safe" playlist. Keep world-verified honest partial, or refuse.
    if (finalTracks.length >= 3) {
      noteReliabilityFallback("human_save_gate_honest_partial_candidate");
      humanSaveabilityDiagnostics = {
        ...humanSaveabilityDiagnostics,
        hardFailed: true,
        degradedDelivery: true,
        honestPartialCap,
        honestPartialDelivered: finalTracks.length,
      };
    } else if (opts.deferHumanSaveGateForContractComposition) {
      noteReliabilityFallback("human_save_gate_deferred_for_contract_composition");
      humanSaveabilityDiagnostics = {
        ...humanSaveabilityDiagnostics,
        hardFailed: true,
        deferredForContractComposition: true,
        honestPartialDelivered: finalTracks.length,
      };
    } else {
      const rejectionReasons = [...humanSaveGate.evaluation.rejectionReasons, "human_quality_refuse_stub"];
      if (insufficientOpeningWorldReason) rejectionReasons.push(insufficientOpeningWorldReason);
      const gateFailureTrace = finalizeExecutionTrace(
        buildGateFailureExecutionTraceDraft({
          requestId: opts.requestId ?? "unknown",
          prompt: vibe,
          seed: opts.seed ?? null,
          intentCollapseLayer: intentCollapseTrace(),
          gate: {
            ...humanSaveGate.evaluation,
            rejectionReasons,
          },
        }),
      );
      throw new HumanSaveabilityGateError(
        { ...humanSaveGate.evaluation, rejectionReasons },
        humanSaveGate.retriesUsed,
        humanSaveGate.failureAttribution as Record<string, unknown>,
        gateFailureTrace,
      );
    }
  }

  if (sceneWorldContext?.active && finalTracks.length > 0) {
    editorialAudit = {
      tracks: finalTracks,
      swaps: [],
      outlierCount: humanSaveGate.evaluation.offendingTracks.length,
      firstTenCohesion: humanSaveGate.sceneWorldMetrics?.firstTenCohesion ?? 0,
    };
  }

  const deliveryTier: GenerationDeliveryTier = resolveGenerationDeliveryTier({
    targetCount,
    finalTrackCount: finalTracks.length,
    gatePassed: humanSaveGate.passed,
    degradationReasons: opts.pipelineTrace?.degradationReasons ?? [],
    preferredIntentPoolMet: !isIntentPoolBelowPreferred(
      postIntentFilterCountFinal,
      targetCount,
      effectiveHumanSaveStrict,
    ),
  });
  humanSaveabilityDiagnostics = {
    ...humanSaveabilityDiagnostics,
    deliveryTier,
  };

  const sceneWorldMetrics = humanSaveGate.sceneWorldMetrics
    ?? (sceneWorldContext?.active ? scorePlaylistWorldMetrics(finalTracks, sceneWorldContext) : null);
  if (sceneWorldMetrics && sceneWorldProofAcc) {
    sceneWorldMetrics.sceneClusterViolationsRemoved = sceneWorldProofAcc.membershipFiltered.filter((row) =>
      row.removalReason.includes("scene cluster") ||
      row.removalReason.includes("wrong scene cluster"),
    ).length;
  }

  const worldCoherence = computeWorldCoherenceScore({
    tracks: finalTracks.map((track) => ({
      artistName: track.artistName ?? null,
      genreFamily: track.genreFamily ?? null,
      genrePrimary: track.genrePrimary ?? null,
    })),
    worldConsistency: sceneWorldMetrics?.worldConsistency ?? null,
    vibe,
    primarySubgenre: lockedIntent.primarySubgenre ?? null,
    genreFamilies: lockedIntent.genreFamilies,
    prototypeCentres: genrePrototypeCentres,
  });

  // Soft repair: when the playlist would not read as a Spotify editorial list,
  // run one denser local-search pass before freezing diagnostics.
  let worldCoherenceRepairMoves = 0;
  let worldCoherenceAfterRepair = worldCoherence;
  if (
    !worldCoherence.wouldSpotifyMakeThis &&
    !opts.shouldSkipMarginalImprovement?.() &&
    finalTracks.length >= 8
  ) {
    const repair = improvePlaylistByLocalSearch(
      finalTracks.map(toPatternTrack),
      localSearchPool,
      {
        maxIterations: humanSaveStrictMode ? 40 : 28,
        seed: `${opts.requestId ?? vibe}:world-coherence-repair`,
        scoringContext: curationScoringContext,
        preferWorldDensity: true,
      },
    );
    worldCoherenceRepairMoves = repair.moves.length;
    if (repair.moves.length > 0 && repair.scoreAfter >= repair.scoreBefore - 0.0005) {
      const byId = new Map<string, (typeof finalTracks)[number]>();
      for (const track of finalTracks) byId.set(track.trackId, track);
      for (const track of retrievedTracks) {
        if (!byId.has(track.trackId)) {
          byId.set(track.trackId, {
            ...track,
            clusterId: (track as { clusterIds?: string[] }).clusterIds?.[0] ?? null,
          } as (typeof finalTracks)[number]);
        }
      }
      const mapped = repair.tracks
        .map((track) => byId.get(track.trackId))
        .filter((track): track is (typeof finalTracks)[number] => !!track);
      if (mapped.length >= Math.max(8, Math.floor(finalTracks.length * 0.75))) {
        finalTracks = mapped;
        worldCoherenceAfterRepair = computeWorldCoherenceScore({
          tracks: finalTracks.map((track) => ({
            artistName: track.artistName ?? null,
            genreFamily: track.genreFamily ?? null,
            genrePrimary: track.genrePrimary ?? null,
          })),
          worldConsistency: sceneWorldMetrics?.worldConsistency ?? null,
          vibe,
          primarySubgenre: lockedIntent.primarySubgenre ?? null,
          genreFamilies: lockedIntent.genreFamilies,
          prototypeCentres: genrePrototypeCentres,
        });
      }
    }
  }
  const worldCoherenceFinal = worldCoherenceAfterRepair;

  const artistCountsForGate = new Map<string, number>();
  for (const track of finalTracks) {
    const artist = (track.artistName ?? "").toLowerCase().trim();
    if (!artist) continue;
    artistCountsForGate.set(artist, (artistCountsForGate.get(artist) ?? 0) + 1);
  }
  let dominantArtistShare: number | null = null;
  if (finalTracks.length > 0 && artistCountsForGate.size > 0) {
    const maxArtist = Math.max(...artistCountsForGate.values());
    dominantArtistShare = maxArtist / finalTracks.length;
  }
  const holidayNegated = promptSuppressesChristmas(vibe);
  const holidayRequested =
    !holidayNegated &&
    /\b(?:christmas|xmas|festive|noel|santa|holiday\s+song|holiday\s+classics)\b/i.test(vibe);
  const feelGoodLanePurity =
    inferredWorldIds.includes("feel_good_world") || inferredWorldIds.includes("party_prep_world")
      ? scoreFeelGoodLanePurity(
        finalTracks.map((t) => ({
          artistName: t.artistName,
          genreFamily: t.genreFamily,
          genrePrimary: t.genrePrimary,
        })),
      ).purity
    : null;
  const negationProfile = parsePromptNegationEnforcement(vibe);
  const negationFiltered = filterTracksForDeliveryNegation(
    finalTracks.map((t) => ({
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: t.albumName,
      genreFamily: t.genreFamily,
      genrePrimary: t.genrePrimary,
      spotifyArtistGenres: (t as { spotifyArtistGenres?: unknown }).spotifyArtistGenres,
      acousticness: t.acousticness,
      instrumentalness: (t as { instrumentalness?: number | null }).instrumentalness,
    })),
    negationProfile,
  );
  if (negationFiltered.removed > 0) {
    const keptIds = new Set(
      negationFiltered.tracks.map((t) => `${t.artistName ?? ""}|${t.trackName ?? ""}`),
    );
    finalTracks = finalTracks.filter((t) =>
      keptIds.has(`${t.artistName ?? ""}|${t.trackName ?? ""}`),
    );
  }
  if (committedWorld?.hardLock) {
    const culturalProfile = resolveCulturalProfileForCommitted(committedWorld);
    const thesis = enforceThesisOpener(
      finalTracks,
      culturalProfile,
      committedWorld,
      undefined,
      20,
      negationProfile.excludedArtists,
    );
    finalTracks = applyWorldSequencing(thesis.tracks, committedWorld);
    const purity = applyWorldPurityGate(finalTracks, committedWorld, {
      prompt: vibe,
      requestedLength: targetCount,
      preserveOpener: true,
      replacementPool: mergeDeliverableCandidatePools(
        finalTracks,
        retrievedTracks,
      ),
    });
    if (purity.removed > 0 && purity.tracks.length >= 3) {
      finalTracks = purity.tracks as typeof finalTracks;
    }
    const humanCuration = applyHumanCurationSequencing(finalTracks, {
      prompt: vibe,
      preserveThesisOpener: true,
      culturalProfile,
    });
    if (
      humanCuration.swaps > 0 ||
      humanCuration.reorders > 0 ||
      humanCuration.removals > 0 ||
      humanCuration.replacements > 0
    ) {
      finalTracks = humanCuration.tracks as typeof finalTracks;
    }
  }
  const spamFiltered = finalTracks.filter(
    (track) =>
      !isSemanticSpamTrack({
        trackName: track.trackName,
        artistName: track.artistName,
      }),
  );
  if (spamFiltered.length < finalTracks.length) {
    finalTracks = spamFiltered as typeof finalTracks;
  }
  const worldProof = evaluateWorldProof({
    tracks: finalTracks.map((t) => ({
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: t.albumName,
      genreFamily: t.genreFamily,
      genrePrimary: t.genrePrimary,
      spotifyArtistGenres: (t as { spotifyArtistGenres?: unknown }).spotifyArtistGenres,
      energy: t.energy,
      valence: t.valence,
      danceability: t.danceability,
      acousticness: t.acousticness,
    })),
    committed: committedWorld,
    prompt: vibe,
    requestedLength: targetCount,
  });
  const intentFidelity = worldProof.fidelity;
  const humanQualityGate: HumanQualityGateResult = evaluateHumanQualityGate({
    trackCount: finalTracks.length,
    requestedLength: targetCount,
    wouldSpotifyMakeThis: worldCoherenceFinal.wouldSpotifyMakeThis,
    dominantWorldDensity: worldCoherenceFinal.dominantWorldDensity,
    retrievalEntropy: worldCoherenceFinal.retrievalEntropy,
    humanSavePassed: humanSaveGate.passed && humanSaveGate.evaluation.humanSaveable,
    curatorScore: humanSaveGate.evaluation.curatorScore ?? null,
    degradedDelivery: humanSaveabilityDiagnostics.degradedDelivery === true,
    seasonalLeakage: false,
    holidayRequested,
    holidayNegated,
    uniqueArtistCount: artistCountsForGate.size,
    dominantArtistShare,
    promptLabel: vibe,
    activeWorldId: activeCommittedWorldId,
    feelGoodLanePurity,
    intentFidelityFailed:
      committedWorld?.hardLock === true &&
      (!worldProof.passed || !intentFidelity.openerPassed),
    worldProofFailed:
      committedWorld?.hardLock === true && !worldProof.passed,
    committedWorldHardLock: committedWorld?.hardLock ?? false,
  });
  if (humanQualityGate.action === "refuse") {
    if (opts.deferHumanSaveGateForContractComposition) {
      noteReliabilityFallback("human_quality_gate_deferred_for_contract_composition");
      humanSaveabilityDiagnostics = {
        ...humanSaveabilityDiagnostics,
        humanQualityGateDeferredForContractComposition: true,
        humanQualityGateWouldRefuse: true,
        humanQualityGateReasons: humanQualityGate.reasons,
      };
    } else {
      throw new HumanQualityGateError(humanQualityGate);
    }
  }
  if (
    committedWorld?.hardLock === true &&
    (!worldProof.passed || !intentFidelity.passed || intentFidelity.worldVerifiedCount < finalTracks.length)
  ) {
    finalTracks = filterTracksByWorldIdentity(finalTracks, intentFidelity, committedWorld);
  }
  if (
    humanQualityGate.action === "honest_partial" &&
    humanQualityGate.salvageableCount > 0 &&
    finalTracks.length > humanQualityGate.salvageableCount
  ) {
    if (
      committedWorld?.hardLock === true &&
      (!intentFidelity.passed || !intentFidelity.openerPassed)
    ) {
      finalTracks = selectIntentFidelityHonestPartialTracks(
        finalTracks,
        intentFidelity,
        committedWorld,
      );
    } else {
      finalTracks = finalTracks.slice(0, humanQualityGate.salvageableCount);
    }
  }

  let sceneWorldProof: SceneWorldProofReport | null = null;
  if (sceneWorldProofAcc && sceneWorldContext?.active) {
    sceneWorldProof = buildSceneWorldProofReport({
      prompt: vibe,
      context: sceneWorldContext,
      beforeByTrack: sceneWorldProofAcc.beforeByTrack,
      afterByTrack: sceneWorldProofAcc.afterByTrack,
      membershipFiltered: sceneWorldProofAcc.membershipFiltered
        .sort((a, b) => a.previousRank - b.previousRank)
        .slice(0, 80),
      editorialRemoved,
      finalTracks,
      metrics: sceneWorldMetrics
        ? {
            worldConsistency: sceneWorldMetrics.worldConsistency,
            archetypeConsistency: sceneWorldMetrics.archetypeConsistency,
            outlierCount: sceneWorldMetrics.outlierCount,
            firstTenClusterConsistency: sceneWorldMetrics.firstTenClusterConsistency,
            clusterPurity: sceneWorldMetrics.clusterPurity,
            dominantSceneCluster: sceneWorldMetrics.dominantSceneCluster,
            sceneClusterViolationsRemoved: sceneWorldMetrics.sceneClusterViolationsRemoved,
          }
        : null,
      firstTenCohesion: editorialAudit?.firstTenCohesion ?? sceneWorldMetrics?.firstTenCohesion ?? 0,
      firstTenClusterConsistency: sceneWorldMetrics?.firstTenClusterConsistency ?? 0,
    });
  }

  const finalSelectionMeta = new Map<string, {
    laneId: string;
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds: string[];
    diversity: DiversityTraceComponents | null;
  }>();
  for (const t of finalTracks) {
    finalSelectionMeta.set(t.trackId, {
      laneId: t.sourceLane,
      laneScore: t.laneScore,
      genrePrimary: t.genrePrimary,
      laneEra: t.laneEra,
      clusterIds: t.clusterIds,
      diversity: t.diversity ?? null,
    });
  }

  const finalLaneContributions: Record<string, number> = {};
  for (const t of finalTracks) {
    finalLaneContributions[t.sourceLane] = (finalLaneContributions[t.sourceLane] ?? 0) + 1;
  }
  const finalLaneUsageRatios: Record<string, number> = {};
  const finalLaneTotal = finalTracks.length || 1;
  for (const [laneId, count] of Object.entries(finalLaneContributions)) {
    finalLaneUsageRatios[laneId] = Math.round((count / finalLaneTotal) * 1000) / 1000;
  }
  const diagnosticLaneDetails = laneDetails.map((ld) => ({
    ...ld,
    selectedCount: finalLaneContributions[ld.laneId] ?? 0,
  }));

  if (fullDiagnostics) {
    const finalTrackIds = new Set(finalTracks.map((t) => t.trackId));
    const tracedIds = new Set(finalDecisionTrace.map((t) => t.trackId));
    for (const trace of finalDecisionTrace) {
      const selectedInFinal = finalTrackIds.has(trace.trackId);
      if (selectedInFinal) {
        const meta = finalSelectionMeta.get(trace.trackId);
        if (meta) {
          trace.lane = meta.laneId;
          trace.enteredLane = meta.laneId;
          trace.laneScore = Math.round(meta.laneScore * 1000) / 1000;
          trace.clusterId = meta.clusterIds[0] ?? trace.clusterId;
          const diversity = meta.diversity ?? emptyDiversityTraceComponents();
          trace.diversityPenalty = diversity.totalPenalty;
          trace.artistMemoryPenalty = diversity.artistMemoryPenalty;
          trace.recentTrackPenalty = diversity.recentTrackPenalty;
          trace.trackReusePenalty = diversity.trackReusePenalty;
          trace.clusterSaturationPenalty = diversity.clusterSaturationPenalty;
          trace.familySaturationPenalty = diversity.familySaturationPenalty;
          trace.diversityMultiplier = diversity.finalMultiplier;
          trace.artistGravity = diversity.artistGravity;
        }
        trace.selected = true;
        trace.selectionReason = trace.selectionReason ?? "interleaver_final";
        trace.rejectionReason = null;
        continue;
      }
      if (trace.selected) {
        trace.selected = false;
        trace.selectionReason = null;
        trace.rejectionReason = "interleaver_not_used";
      }
    }
    for (const id of finalTrackIds) {
      if (tracedIds.has(id)) continue;
      const meta = finalSelectionMeta.get(id)!;
      const diversity = meta.diversity ?? emptyDiversityTraceComponents();
      finalDecisionTrace.push({
        trackId: id,
        lane: meta.laneId,
        enteredLane: meta.laneId,
        laneScore: Math.round(meta.laneScore * 1000) / 1000,
        rawLaneScore: Math.round(meta.laneScore * 1000) / 1000,
        diversityPenalty: diversity.totalPenalty,
        artistMemoryPenalty: diversity.artistMemoryPenalty,
        recentTrackPenalty: diversity.recentTrackPenalty,
        trackReusePenalty: diversity.trackReusePenalty,
        clusterSaturationPenalty: diversity.clusterSaturationPenalty,
        familySaturationPenalty: diversity.familySaturationPenalty,
        diversityMultiplier: diversity.finalMultiplier,
        artistGravity: diversity.artistGravity,
        clusterId: meta.clusterIds[0] ?? null,
        clusterWeight: null,
        selected: true,
        selectionReason: "interleaver_final",
        rejectionReason: null,
      });
    }
  }

  // ── Stage 8: Post-hoc global diversity audit ─────────────────────────────
  let postWindow = createDiversityWindow();
  for (const t of finalTracks) {
    const meta = finalSelectionMeta.get(t.trackId);
    postWindow = updateDiversityWindow(postWindow, {
      genre:  meta?.genrePrimary ?? opts.genreByTrack?.(t.trackId) ?? "unknown",
      era:    meta?.laneEra ?? "any",
      artist: t.artistName,
      energy: t.energy ?? 0.50,
      lane:   meta?.laneId ?? "unknown",
    });
  }
  const postMetrics = computeDiversityMetrics(postWindow);

  // ── Build diagnostics ────────────────────────────────────────────────────
  const genreDist: Record<string, number> = {};
  const eraDist: Record<string, number>   = {};
  for (const t of finalTracks) {
    const g = opts.genreByTrack?.(t.trackId) ?? "unknown";
    genreDist[g] = (genreDist[g] ?? 0) + 1;
  }
  for (const t of finalTracks) {
    eraDist[t.laneEra] = (eraDist[t.laneEra] ?? 0) + 1;
  }

  const artistDist: Record<string, number> = {};
  for (const t of finalTracks) {
    artistDist[t.artistName] = (artistDist[t.artistName] ?? 0) + 1;
  }

  const genreValues = Object.values(genreDist);
  const totalGenre = genreValues.reduce((s, v) => s + v, 0) || 1;
  const genreConcentration = Math.max(...genreValues, 0) / totalGenre;
  if (!fullDiagnostics) {
    timingMs.total = Date.now() - pipelineStartedAt;
    const slowestTiming = Object.entries(timingMs)
      .filter(([key]) => key !== "total")
      .sort((a, b) => b[1] - a[1])[0] ?? null;

    return {
      finalTracks,
      diagnostics: {
        pipelineVersion: "v3.1_unified_routing",
        diagnosticsMode: "minimal",
        timingMs: {
          ...timingMs,
          slowestStage: slowestTiming?.[0] ?? null,
          slowestStageMs: slowestTiming?.[1] ?? 0,
        },
        degraded: opts.pipelineTrace?.degraded ?? false,
        degradationReasons: opts.pipelineTrace?.degradationReasons ?? [],
        failureTrace: opts.pipelineTrace?.failures ?? [],
        recoveryEvents: opts.pipelineTrace?.recoveryEvents ?? [],
        systemHealth: healthState,
        activePath: fallbackTriggered
          ? "fallback_ensemble"
          : intentDecomposer.fallbackSuppressed
            ? "compound_anchor_lanes"
            : "adaptive",
        finalDistribution: {
          genres: genreDist,
          eras: eraDist,
          artists: artistDist,
        },
        fallback: {
          triggered: fallbackTriggered,
          reason: fallbackTriggered
            ? "unclear_intent_multi_lane_ensemble"
            : intentDecomposer.fallbackSuppressed
              ? intentDecomposer.fallbackReason
              : "nominal",
          intentDecomposer,
        },
        intentDecomposer,
        humanSaveabilityGate: humanSaveabilityDiagnostics,
        worldCoherence: {
          score: worldCoherenceFinal.score,
          wouldSpotifyMakeThis: worldCoherenceFinal.wouldSpotifyMakeThis,
          dominantWorldDensity: worldCoherenceFinal.dominantWorldDensity,
          worldConsistency: worldCoherenceFinal.worldConsistency,
          prototypeAffinity: worldCoherenceFinal.prototypeAffinity,
          retrievalEntropy: worldCoherenceFinal.retrievalEntropy,
          dominantFamily: worldCoherenceFinal.density.dominantFamily,
          dominantShare: worldCoherenceFinal.density.dominantShare,
          familyCounts: worldCoherenceFinal.density.counts,
          prototypeCentres: worldCoherenceFinal.prototypeCentres,
          reasons: worldCoherenceFinal.reasons,
          repairMoves: worldCoherenceRepairMoves,
          repaired: worldCoherenceRepairMoves > 0,
          scoreBeforeRepair: worldCoherence.score,
          wouldSpotifyMakeThisBeforeRepair: worldCoherence.wouldSpotifyMakeThis,
        },
        humanQualityGate: {
          action: humanQualityGate.action,
          reasons: humanQualityGate.reasons,
          userMessage: humanQualityGate.userMessage,
          salvageableCount: humanQualityGate.salvageableCount,
          wouldSaveConfidence: humanQualityGate.wouldSaveConfidence,
          replayConfidence: humanQualityGate.replayConfidence,
          worldCoherenceOk: humanQualityGate.worldCoherenceOk,
          stubUnderfill: humanQualityGate.stubUnderfill,
        },
        lanes: diagnosticLaneDetails.map((ld) => ({
          laneId: ld.laneId,
          type: ld.type,
          label: ld.label,
          weight: ld.weight,
          scoredCount: ld.scoredCount,
          selectedCount: ld.selectedCount,
        })),
        globalDiversityMetrics: {
          preInterleave: {
            genreConcentration: postMetrics.genreConcentration,
            eraConcentration: postMetrics.eraConcentration,
            artistRepeatIndex: postMetrics.artistRepeatIndex,
            laneSaturation: postMetrics.laneSaturation,
            driftState: postMetrics.driftState,
            clusterCollapseIndex: postMetrics.clusterCollapseIndex,
            explorationPressure: postMetrics.explorationPressure,
          },
          postInterleave: {
            genreConcentration: postMetrics.genreConcentration,
            eraConcentration: postMetrics.eraConcentration,
            artistRepeatIndex: postMetrics.artistRepeatIndex,
            laneSaturation: postMetrics.laneSaturation,
            driftState: postMetrics.driftState,
            clusterCollapseIndex: postMetrics.clusterCollapseIndex,
            explorationPressure: postMetrics.explorationPressure,
            dominantGenre: postMetrics.dominantGenre,
            dominantEra: postMetrics.dominantEra,
          },
        },
        poolSize: tracks.length,
        selectedCount: finalTracks.length,
        genreDistribution: genreDist,
        eraDistribution: eraDist,
        genreConcentrationScore: Math.round(genreConcentration * 1000) / 1000,
        genreConcentrationPct: `${Math.round(genreConcentration * 100)}%`,
        eraConcentrationPct: `${Math.round(postMetrics.eraConcentration * 100)}%`,
        repetitionIndex: postMetrics.artistRepeatIndex,
        clusterCollapseIndex: postMetrics.clusterCollapseIndex,
        explorationPressureScore: postMetrics.explorationPressure,
        driftState: postMetrics.driftState,
        generationDebug: {
          emptyPlaylistReason: finalTracks.length === 0 ? "no_tracks_after_v3_selection" : undefined,
          relaxationSteps: [],
          fallbackTriggered,
          constraintFailures: finalTracks.length === 0 ? ["v3_final_selection_empty"] : [],
        },
      },
    };
  }

  // ── Build playlist explanation ────────────────────────────────────────────
  const totalLaneSelected = Object.values(finalLaneContributions).reduce((s, count) => s + count, 0) || 1;
  const totalTracesSelected = finalDecisionTrace.filter((t) => t.selected).length;
  const totalTracesRejected = finalDecisionTrace.length - totalTracesSelected;
  const rejectionCounts: Record<string, number> = {};
  for (const t of finalDecisionTrace) {
    if (!t.selected && t.rejectionReason) {
      rejectionCounts[t.rejectionReason] = (rejectionCounts[t.rejectionReason] ?? 0) + 1;
    }
  }
  const topRejectionReasons = Object.entries(rejectionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r]) => r);

  const clusterMapAgg: Record<string, { trackCount: number; genres: string[]; weightContribution: number }> = {};
  for (const ld of diagnosticLaneDetails) {
    for (const [cid, ratio] of Object.entries(ld.clusterSelectionRatios)) {
      if (!clusterMapAgg[cid]) clusterMapAgg[cid] = { trackCount: 0, genres: [], weightContribution: 0 };
      clusterMapAgg[cid].weightContribution = Math.max(clusterMapAgg[cid].weightContribution, ratio as number);
      if (cid.startsWith("genre:")) {
        const g = cid.replace("genre:", "");
        if (!clusterMapAgg[cid].genres.includes(g)) clusterMapAgg[cid].genres.push(g);
      }
    }
    for (const [cid, count] of Object.entries(ld.clusterSpread)) {
      if (clusterMapAgg[cid]) clusterMapAgg[cid].trackCount += count as number;
    }
  }

  const playlistExplanation = {
    intentSummary: {
      primaryIntent: decomposed.primary,
      secondaryIntents: decomposed.secondaryIntents as string[],
      moodTags: decomposed.moodTags,
      confidence: decomposed.confidence,
      emotionVector: {
        energy:    Math.round((profile.energy    ?? 0.5) * 100) / 100,
        valence:   Math.round((profile.valence   ?? 0.5) * 100) / 100,
        tension:   Math.round((profile.tension   ?? 0.3) * 100) / 100,
        nostalgia: Math.round((profile.nostalgia ?? 0.2) * 100) / 100,
        calm:      Math.round((profile.calm      ?? 0.5) * 100) / 100,
      },
      eraVector: eraDist,
      sceneInfluenceMap: Object.fromEntries(
        Object.entries(decomposed.sceneInfluenceMap as Record<string, number>)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5),
      ),
      activePath: fallbackTriggered
        ? "fallback_ensemble"
        : intentDecomposer.fallbackSuppressed
          ? "compound_anchor_lanes"
          : "adaptive",
    },
    laneBreakdown: Object.fromEntries(
      diagnosticLaneDetails.map((ld) => [ld.laneId, Math.round((ld.selectedCount / totalLaneSelected) * 100)]),
    ),
    laneDetails: diagnosticLaneDetails.map((ld) => ({
      laneId:          ld.laneId,
      label:           ld.label,
      type:            ld.type,
      weight:          ld.weight,
      scoredCount:     ld.scoredCount,
      strictCandidateCount: ld.strictCandidateCount,
      relaxedCandidateCount: ld.relaxedCandidateCount,
      retrievalStrictness: ld.retrievalStrictness,
      selectedCount:   ld.selectedCount,
      dominantCluster: ld.dominantCluster,
      clusterPurity: ld.clusterPurity,
      secondaryClusterAllowed: ld.secondaryClusterAllowed,
      secondaryClusterReason: ld.secondaryClusterReason,
      pctContribution: Math.round((ld.selectedCount / totalLaneSelected) * 100),
    })),
    clusterMap: clusterMapAgg,
    diversityReport: {
      genreEntropy:      Math.round(shannonEntropyNormalized(genreDist)  * 1000) / 1000,
      artistEntropy:     Math.round(shannonEntropyNormalized(artistDist) * 1000) / 1000,
      eraEntropy:        Math.round(shannonEntropyNormalized(eraDist)    * 1000) / 1000,
      diversityPressure: Math.round(postMetrics.explorationPressure      * 1000) / 1000,
      genreCount:   Object.keys(genreDist).length,
      artistCount:  Object.keys(artistDist).length,
      eraCount:     Object.keys(eraDist).length,
      dominantGenre: postMetrics.dominantGenre,
      dominantEra:   postMetrics.dominantEra,
    },
    selectionSummary: {
      totalCandidates: finalDecisionTrace.length,
      selected:        totalTracesSelected,
      rejected:        totalTracesRejected,
      topRejectionReasons,
      selectionRate: finalDecisionTrace.length > 0
        ? Math.round((totalTracesSelected / finalDecisionTrace.length) * 100)
        : 100,
    },
  };

  const firstZeroCollapse = forensicTrace.find((trace) => trace.before > 0 && trace.after === 0) ?? null;
  const largestDrop = forensicTrace
    .filter((trace) => trace.removed > 0)
    .sort((a, b) => b.removed - a.removed)[0] ?? null;

  // Build cluster distribution graph (genre clusters only for brevity)
  const clusterDistributionGraph: Record<string, number> = {};
  for (const ld of diagnosticLaneDetails) {
    for (const [cid, ratio] of Object.entries(ld.clusterSelectionRatios)) {
      if (cid.startsWith("genre:")) {
        clusterDistributionGraph[cid] = Math.max(
          clusterDistributionGraph[cid] ?? 0,
          ratio,
        );
      }
    }
  }
  const finalClusterCounts: Record<string, number> = {};
  for (const track of finalTracks) {
    const cid = track.clusterIds[0] ?? "unknown";
    finalClusterCounts[cid] = (finalClusterCounts[cid] ?? 0) + 1;
  }
  const [dominantCluster, dominantClusterCount] = Object.entries(finalClusterCounts)
    .sort((a, b) => b[1] - a[1])[0] ?? ["unknown", 0];
  const clusterPurity = finalTracks.length > 0
    ? Math.round((dominantClusterCount / finalTracks.length) * 1000) / 1000
    : 0;
  const artistReuseRate = finalTracks.length > 0
    ? Math.round((1 - Object.keys(artistDist).length / finalTracks.length) * 1000) / 1000
    : 0;
  timingMs.total = Date.now() - pipelineStartedAt;
  const slowestTiming = Object.entries(timingMs)
    .filter(([key]) => key !== "total")
    .sort((a, b) => b[1] - a[1])[0] ?? null;

  const diagnostics: Record<string, unknown> = {
    pipelineVersion: "v3.1_unified_routing",
    timingMs: {
      ...timingMs,
      slowestStage: slowestTiming?.[0] ?? null,
      slowestStageMs: slowestTiming?.[1] ?? 0,
    },
    degraded: opts.pipelineTrace?.degraded ?? false,
    degradationReasons: opts.pipelineTrace?.degradationReasons ?? [],
    deliveryTier,
    failureTrace: opts.pipelineTrace?.failures ?? [],
    recoveryEvents: opts.pipelineTrace?.recoveryEvents ?? [],
    systemHealth: healthState,
    activePath: fallbackTriggered
      ? "fallback_ensemble"
      : intentDecomposer.fallbackSuppressed
        ? "compound_anchor_lanes"
        : "adaptive",
    qualityLock: {
      active: false,
      implemented: false,
      reason: "quality_lock_module_missing",
      trackDuplicatesRemoved: 0,
      genreExclusionsApplied: 0,
      artistDuplicatesRemoved: 0,
      refillCount: 0,
      entropyRefillApplied: false,
      vibeOutliersSwapped: 0,
      finalGenreEntropy: Math.round(shannonEntropyNormalized(genreDist) * 1000) / 1000,
      excludedGenres: [],
      maxArtistRule: 0,
      intentLockApplied: lockedIntent.genreFamilies.length > 0 || !!lockedIntent.eraRange,
    },
    playlistExplanation,
    finalDecisionTrace,
    selectionTrace: finalDecisionTrace,
    clusters: diagnosticLaneDetails.map((ld) => ({
      laneId: ld.laneId,
      clusterSpread: ld.clusterSpread,
      clusterSelectionRatios: ld.clusterSelectionRatios,
    })),
    finalDistribution: {
      genres: genreDist,
      eras: eraDist,
      artists: artistDist,
    },
    intentDecomposition: {
      primary: decomposed.primary,
      secondaryIntents: decomposed.secondaryIntents,
      moodTags: decomposed.moodTags,
      confidence: decomposed.confidence,
      contextAnchors: decomposed.contextAnchors,
      sceneInfluenceMap: Object.fromEntries(
        Object.entries(decomposed.sceneInfluenceMap).sort((a, b) => b[1] - a[1]),
      ),
      intentDecomposer,
    },
    intentDecomposer,
    adaptiveLaneGenerator: generatorDiagnostics,
    unifiedIntent: unifiedIntentDiagnostics,
    forensicPoolTrace: {
      firstZeroCollapse,
      largestDrop,
      stages: forensicTrace,
    },
    retrievalRelaxation: {
      minPoolPolicy: "per_lane_dynamic_minimum",
      ladder: RETRIEVAL_RELAXATION_LADDER,
      lanes: diagnosticLaneDetails.map((ld) => ({
        laneId: ld.laneId,
        strictCandidateCount: ld.strictCandidateCount,
        relaxedCandidateCount: ld.relaxedCandidateCount,
        appliedLevel: ld.retrievalStrictness,
      })),
    },
    recommendationEngine: {
      mode: "single_decision_engine",
      normalisation: "per_lane_signal_domain",
      lanes: recommendationEngineDiagnostics,
    },
    embeddingRetrieval: {
      mode: "session_multi_vector_retrieval",
      totalCandidates: retrievalCloud.tracks.length,
      neighborhoodCounts: retrievalCloud.neighborhoodCounts,
      userTasteState: {
        longTermTasteDims: retrievalCloud.userTasteState.longTermTasteVector.length,
        sessionDims: retrievalCloud.userTasteState.shortTermSessionVector.length,
        moodTrajectoryDims: retrievalCloud.userTasteState.moodTrajectoryVector.length,
        scenePreferenceDims: retrievalCloud.userTasteState.scenePreferenceVector.length,
      },
      playlistEmbedding: {
        centroidDims: retrievalCloud.playlistEmbedding.centroidVector.length,
        energyCurveDims: retrievalCloud.playlistEmbedding.energyCurveVector.length,
        diversitySpreadDims: retrievalCloud.playlistEmbedding.diversitySpreadVector.length,
        emotionalArcDims: retrievalCloud.playlistEmbedding.emotionalArcVector.length,
      },
      memoryGraph: {
        listenedTrackNodes: retrievalCloud.memoryGraph.listenedTracksEmbeddingGraph.length,
        sessionTransitions: retrievalCloud.memoryGraph.sessionTransitions.length,
        skippedClusterCount: Object.keys(retrievalCloud.memoryGraph.skippedClusters).length,
        replayedClusterCount: Object.keys(retrievalCloud.memoryGraph.replayedClusters).length,
      },
      clusterEmbeddings: retrievalCloud.clusterEmbeddings.map((cluster) => ({
        id: cluster.id,
        size: cluster.size,
        averageAffinity: Math.round(cluster.averageAffinity * 1000) / 1000,
      })),
      topCandidateAffinities: retrievalCloud.tracks.slice(0, 10).map((candidate) => ({
        trackId: candidate.track.trackId,
        embeddingAffinity: Math.round(candidate.embeddingAffinity * 1000) / 1000,
        retrievalNeighborhood: candidate.retrievalNeighborhood,
      })),
    },
    candidateValidation: {
      repairedCount: 0,
      droppedCount: 0,
    },
    generationDebug: {
      emptyPlaylistReason: finalTracks.length === 0 ? "no_tracks_after_v3_selection" : undefined,
      relaxationSteps: [],
      dominantCluster,
      clusterPurity,
      artistReuseRate,
      fallbackTriggered,
      constraintFailures: finalTracks.length === 0 ? ["v3_final_selection_empty"] : [],
    },
    sessionArtistMemory: sessionArtistMemoryDiagnostics(opts.sessionArtistMemory),
    lanes: diagnosticLaneDetails,
    laneContributions: finalLaneContributions,
    fallback: {
      triggered: fallbackTriggered,
      reason: fallbackTriggered
        ? "unclear_intent_multi_lane_ensemble"
        : intentDecomposer.fallbackSuppressed
          ? intentDecomposer.fallbackReason
          : "nominal",
      intentDecomposer,
    },

    // Cluster layer
    clusterDistributionGraph,
    aggregateClusterSpread: diagnosticLaneDetails.reduce(
      (agg, ld) => {
        const spread = ld.clusterSpread;
        for (const [k, v] of Object.entries(spread)) {
          agg[k] = Math.max(agg[k] ?? 0, v);
        }
        return agg;
      },
      {} as Record<string, number>,
    ),

    // Interleaver layer
    interleaverDiagnostics: {
      ...interleaved.interleaverDiagnostics,
      finalLaneUsageRatios,
    },

    // Global diversity layer
    globalDiversityMetrics: {
      // Legacy field shape retained; values are final-selection metrics only.
      preInterleave: {
        genreConcentration:   postMetrics.genreConcentration,
        eraConcentration:     postMetrics.eraConcentration,
        artistRepeatIndex:    postMetrics.artistRepeatIndex,
        laneSaturation:       postMetrics.laneSaturation,
        driftState:           postMetrics.driftState,
        clusterCollapseIndex: postMetrics.clusterCollapseIndex,
        explorationPressure:  postMetrics.explorationPressure,
      },
      postInterleave: {
        genreConcentration:   postMetrics.genreConcentration,
        eraConcentration:     postMetrics.eraConcentration,
        artistRepeatIndex:    postMetrics.artistRepeatIndex,
        laneSaturation:       postMetrics.laneSaturation,
        driftState:           postMetrics.driftState,
        clusterCollapseIndex: postMetrics.clusterCollapseIndex,
        explorationPressure:  postMetrics.explorationPressure,
        dominantGenre:        postMetrics.dominantGenre,
        dominantEra:          postMetrics.dominantEra,
      },
    },

    // Legacy / compatibility fields
    poolSize: tracks.length,
    selectedCount: finalTracks.length,
    deliverableRefillPoolSize: mergeDeliverableCandidatePools(finalTracks, retrievedTracks).length,
    postIntentFilterSurvivors: postIntentFilterCountFinal,
    genreDistribution: genreDist,
    eraDistribution: eraDist,
    genreConcentrationScore: Math.round(genreConcentration * 1000) / 1000,
    genreConcentrationPct: `${Math.round(genreConcentration * 100)}%`,
    eraConcentrationPct: `${Math.round(postMetrics.eraConcentration * 100)}%`,
    repetitionIndex: postMetrics.artistRepeatIndex,
    clusterCollapseIndex: postMetrics.clusterCollapseIndex,
    explorationPressureScore: postMetrics.explorationPressure,
    driftState: postMetrics.driftState,
    diversityStrategy: "v3.1_adaptive_clustered_probabilistic_ecosystem",

    sceneWorldLayer: sceneWorldContext?.active
      ? {
          active: true,
          strictMode: sceneWorldContext.strictMode,
          descriptor: sceneWorldContext.descriptor,
          archetype: {
            id: sceneWorldContext.archetype.id,
            label: sceneWorldContext.archetype.label,
            curatorVoice: sceneWorldContext.archetype.curatorVoice,
            genreFamilies: sceneWorldContext.archetype.genreFamilies,
          },
          candidateArchetypes: sceneWorldContext.candidateArchetypes.map((row) => row.label),
          anchorCount: sceneWorldContext.anchors.length,
          anchorStats: sceneWorldContext.anchorStats,
          editorialAudit: editorialAudit
            ? {
                swaps: editorialAudit.swaps.length,
                outlierCount: editorialAudit.outlierCount,
                firstTenCohesion: editorialAudit.firstTenCohesion,
              }
            : null,
          metrics: sceneWorldMetrics,
          sceneClusters: sceneWorldContext.sceneClusters
            ? {
                dominantCluster: sceneWorldContext.sceneClusters.dominantCluster.label,
                dominantClusterId: sceneWorldContext.sceneClusters.dominantClusterId,
                clusterCount: sceneWorldContext.sceneClusters.clusters.size,
                clusterPurity: sceneWorldMetrics?.clusterPurity ?? sceneWorldContext.sceneClusters.clusterPurity,
                firstTenClusterConsistency: sceneWorldMetrics?.firstTenClusterConsistency ?? 0,
                sceneClusterViolationsRemoved: sceneWorldMetrics?.sceneClusterViolationsRemoved ?? 0,
                adjacencyEdgeCount: sceneWorldContext.sceneClusters.adjacencyEdgeCount,
                coOccurrenceEdgeCount: sceneWorldContext.sceneClusters.coOccurrenceEdgeCount,
              }
            : null,
        }
      : { active: false },

    humanSaveabilityGate: humanSaveabilityDiagnostics,
    worldCoherence: {
      score: worldCoherenceFinal.score,
      wouldSpotifyMakeThis: worldCoherenceFinal.wouldSpotifyMakeThis,
      dominantWorldDensity: worldCoherenceFinal.dominantWorldDensity,
      worldConsistency: worldCoherenceFinal.worldConsistency,
      prototypeAffinity: worldCoherenceFinal.prototypeAffinity,
      retrievalEntropy: worldCoherenceFinal.retrievalEntropy,
      dominantFamily: worldCoherenceFinal.density.dominantFamily,
      dominantShare: worldCoherenceFinal.density.dominantShare,
      familyCounts: worldCoherenceFinal.density.counts,
      prototypeCentres: worldCoherenceFinal.prototypeCentres,
      reasons: worldCoherenceFinal.reasons,
      repairMoves: worldCoherenceRepairMoves,
      repaired: worldCoherenceRepairMoves > 0,
      scoreBeforeRepair: worldCoherence.score,
      wouldSpotifyMakeThisBeforeRepair: worldCoherence.wouldSpotifyMakeThis,
    },
    humanQualityGate: {
      action: humanQualityGate.action,
      reasons: humanQualityGate.reasons,
      userMessage: humanQualityGate.userMessage,
      salvageableCount: humanQualityGate.salvageableCount,
      wouldSaveConfidence: humanQualityGate.wouldSaveConfidence,
      replayConfidence: humanQualityGate.replayConfidence,
      worldCoherenceOk: humanQualityGate.worldCoherenceOk,
      stubUnderfill: humanQualityGate.stubUnderfill,
      intentFidelity,
    },
    genrePrototypeCentres: genrePrototypeCentres.map((c) => ({
      id: c.id,
      family: c.family,
      subgenre: c.subgenre,
      artistCount: c.artists.length,
    })),
    sceneClusterFunnel,
    openingTenDominantCluster,
    editorialPolishLayer: editorialPolishDiagnostics,
    editorialStabiliserLayer: editorialStabiliserDiagnostics,
    intentCollapseLayer: intentCollapseDiagnostics,
    sceneAnchorRetrievalQuota: sceneAnchorRetrievalDiagnostics,
    samplerIntentContext,
    sceneWorldProof,
    playlistExecutionTrace: finalizeExecutionTrace(
      buildV3PipelineExecutionTraceDraft({
        requestId: opts.requestId ?? "unknown",
        prompt: vibe,
        seed: opts.seed ?? null,
        humanSaveable: humanSaveGate.evaluation.humanSaveable,
        gateExecuted: true,
        gateBypassed: false,
        humanSaveabilityGate: humanSaveabilityDiagnostics,
        sceneClusterFunnel,
        openingTenDominantCluster,
        editorialLayer: editorialPolishDiagnostics
          ? {
              repetitionScore: editorialPolishDiagnostics.repetitionScore,
              arcScore: editorialPolishDiagnostics.arcScore,
              textureVarianceScore: editorialPolishDiagnostics.textureVarianceScore,
              flowScore: editorialPolishDiagnostics.flowScore,
              swapsPerformed: editorialPolishDiagnostics.swapsPerformed,
              monotonyFixesApplied: editorialPolishDiagnostics.monotonyFixesApplied,
            }
          : null,
        editorialStabiliser: editorialStabiliserDiagnostics
          ? {
              identityDriftScore: editorialStabiliserDiagnostics.identityDriftScore,
              repetitionRiskScore: editorialStabiliserDiagnostics.repetitionRiskScore,
              arcStabilityScore: editorialStabiliserDiagnostics.arcStabilityScore,
              openingIntegrityScore: editorialStabiliserDiagnostics.openingIntegrityScore,
              openingSwapsPerformed: editorialStabiliserDiagnostics.openingSwapsPerformed,
              arcSwapsPerformed: editorialStabiliserDiagnostics.arcSwapsPerformed,
              repetitionDemotions: editorialStabiliserDiagnostics.repetitionDemotions,
              embeddingStreakBreaks: editorialStabiliserDiagnostics.embeddingStreakBreaks,
              applied: editorialStabiliserDiagnostics.applied,
            }
          : null,
        intentCollapseLayer: intentCollapseTrace(),
        interleaverAudit: humanSaveabilityDiagnostics.interleaverAudit as Record<string, unknown> | undefined,
        dominantClusterLabel: postInterleaverOpeningAudit.dominantClusterLabel,
        retrievedCount: retrievedTracks.length,
        finalTrackCount: finalTracks.length,
        samplerOutputCount,
        partialPipeline: false,
        fastFallback: false,
      }),
    ),
  };

  return { finalTracks, diagnostics, sceneWorldContext };
}
