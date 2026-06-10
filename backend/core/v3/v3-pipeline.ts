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
import { isUnclearIntent } from "./intent-decomposer";
import { buildLanes } from "./lane-router";
import { generateAdaptiveLanes } from "./adaptive-lane-generator";
import { scoreLane } from "./lane-scorer";
import { buildClusters } from "./cluster-candidate-engine";
import { selectFromClusters, type SampledLaneResult } from "./v3-sampler";
import {
  createDiversityWindow,
  updateDiversityWindow,
  computeDiversityMetrics,
} from "./global-diversity-controller";
import { interleaveLanes } from "./interleaver";
import type { TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { EraBucket } from "../../lib/intent-parser";
import type { V3MetadataTrack, V3TrackMetadata } from "../../lib/v3-track-contract";
import { normalizeLockedGenreFamily, type LockedIntent } from "./intent";
import { computeSceneAlignmentScore, trackMatchesConstraints } from "./constraint-filter";
import {
  getRelaxationLevel,
  RETRIEVAL_RELAXATION_LADDER,
  retrieveCandidatesByEmbedding,
  type RetrievalStrictness,
  type RetrievedCandidate,
  type RetrievalTrackLike,
} from "./embedding-retrieval";
import { runRecommendationEngine } from "../engine/recommendation-engine";
import type { MomentMemory } from "../memory/moment-memory";
import {
  createTrackDecision,
  withDecisionAffinities,
  withDecisionValidity,
  type TrackDecision,
} from "./track-decision";
import {
  type UnifiedIntentContext,
} from "../unified-intent";

// ── Types ───────────────────────────────────────────────────────────────────

export interface V3PipelineTrack extends RetrievalTrackLike {
  trackId: string;
  artistName: string;
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
}

type V3SelectionCandidate<T extends V3PipelineTrack> = T & V3TrackMetadata & {
  sourceLane: string;
  laneScore: number;
  genrePrimary: string;
  laneEra: EraBucket;
  clusterIds: string[];
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

function decisionMatchesConstraints<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  lockedIntent: LockedIntent,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): boolean {
  const classification = opts.classificationByTrack?.(decision.track.trackId);
  return trackMatchesConstraints({
    ...decision.track,
    genreFamily: classification?.genreFamily ?? classification?.genrePrimary ?? decision.genrePrimary,
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
  const classification = opts.classificationByTrack?.(decision.track.trackId);
  const genreFamily = normalizeLockedGenreFamily(
    classification?.genreFamily ?? classification?.genrePrimary ?? decision.genrePrimary
  );
  return !!genreFamily &&
    decision.laneEra !== "any" &&
    decision.track.energy !== null;
}

function laneReadinessRejectionReason<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): string | null {
  const classification = opts.classificationByTrack?.(decision.track.trackId);
  const genreFamily = normalizeLockedGenreFamily(
    classification?.genreFamily ?? classification?.genrePrimary ?? decision.genrePrimary
  );
  if (!genreFamily) return "missing genre";
  if (decision.laneEra === "any") return "lane readiness fail: missing era";
  if (decision.track.energy === null) return "lane readiness fail: missing energy";
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
  const track = {
    ...decision.track,
    genreFamily: classification?.genreFamily ?? classification?.genrePrimary ?? decision.genrePrimary,
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
  return decisionHasBasicIdentity(decision) &&
    decision.track.energy !== null &&
    decision.track.valence !== null;
}

function decisionHasUsableGenre<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): boolean {
  const classification = opts.classificationByTrack?.(decision.track.trackId);
  return !!normalizeLockedGenreFamily(
    classification?.genreFamily ?? classification?.genrePrimary ?? decision.genrePrimary
  );
}

function eraAllowedWithDrift<T extends V3PipelineTrack>(
  decision: TrackDecision<T>,
  lockedIntent: LockedIntent,
): boolean {
  if (!lockedIntent.eraRange) return true;
  if (decision.track.releaseYear === null || decision.track.releaseYear === undefined) {
    return decision.laneEra === "any";
  }
  const driftYears = 8;
  return decision.track.releaseYear >= lockedIntent.eraRange.start - driftYears &&
    decision.track.releaseYear <= lockedIntent.eraRange.end + driftYears;
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
  },
): Array<TrackDecision<T>> {
  return decisions.map((decision) => {
    const classification = opts.classificationByTrack?.(decision.track.trackId);
    const genreFamily = classification?.genreFamily ?? classification?.genrePrimary ?? decision.genrePrimary;
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

    return withDecisionAffinities(decision, {
      sceneAffinity,
      tasteAffinity,
      freshnessAffinity,
      embeddingAffinity: retrieval?.embeddingAffinity,
      retrievalNeighborhood: retrieval?.retrievalNeighborhood,
    });
  });
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export function runV3Pipeline<T extends V3PipelineTrack>(
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
  } = {},
): V3PipelineResult<T> {

  // ── Stage 1: Unified intent consumption ──────────────────────────────────
  if (!opts.unifiedIntentContext) {
    throw new Error("UnifiedIntent required — raw prompt parsing disabled");
  }
  const unifiedIntentContext = opts.unifiedIntentContext;
  const decomposed = unifiedIntentContext.decomposedIntent;
  const lockedIntent = opts.lockedIntent ?? unifiedIntentContext.lockedIntent;
  const unifiedIntentDiagnostics = unifiedIntentContext.diagnostics;
  const fallbackTriggered = isUnclearIntent(decomposed);
  const retrievalCloud = retrieveCandidatesByEmbedding(
    tracks,
    lockedIntent,
    unifiedIntentContext.unifiedIntent,
  );
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
  const retrievedTracks = retrievalCloud.tracks.map((candidate) => candidate.track);
  const retrievalByTrack = new Map(
    retrievalCloud.tracks.map((candidate) => [candidate.track.trackId, candidate])
  );

  // ── Stage 2: Adaptive lane generation ───────────────────────────────────
  let lanes: ReturnType<typeof buildLanes>;
  let generatorDiagnostics: Record<string, unknown> = {};

  if (fallbackTriggered) {
    lanes = buildLanes(decomposed);
    generatorDiagnostics = { mode: "fallback_ensemble", reason: "unclear_intent" };
  } else {
    const genResult = generateAdaptiveLanes(decomposed);
    lanes = genResult.lanes;
    generatorDiagnostics = {
      mode: "adaptive",
      activeLaneTypes: genResult.activeLaneTypes,
      ...genResult.generatorDiagnostics,
    };
  }

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
  }> = [];

  // Observability: per-track decision trace (top 15 by raw score per lane)
  const finalDecisionTrace: Array<{
    trackId: string;
    lane?: string;
    enteredLane: string;
    laneScore: number;
    rawLaneScore: number;
    diversityPenalty: number;
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

  const sampledResults: SampledLaneResult<T>[] = lanes.map((lane) => {
    // Stage 3: Score every track for this lane
    const rawScored = scoreLane(retrievedTracks, lane, decomposed, {
      genreByTrack: opts.genreByTrack,
      noveltyByTrack: opts.noveltyByTrack,
    });

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
    });
    const engineResult = runRecommendationEngine({
      decisions: affinityDecisions,
      unifiedIntent: unifiedIntentContext.unifiedIntent,
      memory: opts.momentMemory,
      classificationByTrack: opts.classificationByTrack,
    });
    recommendationEngineDiagnostics.push({
      laneId: lane.id,
      signalCount: engineResult.diagnostics.signalCount,
      weights: engineResult.diagnostics.weights,
      topDecisions: engineResult.diagnostics.topDecisions,
    });

    // Headroom: 3× target so the sampler has enough valid choices.
    const laneTarget = Math.max(
      Math.ceil(targetCount * lane.weight * 3),
      Math.ceil(targetCount * lane.weight) + 10,
    );

    // Stage 4: Build clusters from scored pool
    const clusteredPool = buildClusters(engineResult.decisions);
    forensicTrace.push(stageTrace(
      `cluster creation count:${lane.id}`,
      engineResult.decisions.length,
      clusteredPool.scoredTracks.length,
      clusteredPool.scoredTracks.length < engineResult.decisions.length ? { cluster_creation_drop: engineResult.decisions.length - clusteredPool.scoredTracks.length } : {},
      "backend/core/v3/cluster-candidate-engine.ts",
      "buildClusters",
    ));

    // Stage 5: Entropy-constrained selection across clusters
    const clusterResult = selectFromClusters(
      clusteredPool,
      laneTarget,
      lane.id,
      `${opts.seed ?? "v3"}:${lane.id}`,
    );
    forensicTrace.push(stageTrace(
      `sampler input count:${lane.id}`,
      clusteredPool.scoredTracks.length,
      clusterResult.tracks.length,
      clusterResult.samplerDiagnostics.rejectionReasons,
      "backend/core/v3/v3-sampler.ts",
      "selectFromClusters",
    ));

    // ── Observability: build per-track trace (top 15 by raw score) ───────────
    const selectedIdSet = new Set(clusterResult.tracks.map((t) => t.trackId));
    const rawScoreMap   = new Map(rawScored.map((r) => [r.track.trackId, r.laneScore]));

    const traceEntries = [...rawScored]
      .sort((a, b) => (rawScoreMap.get(b.track.trackId) ?? 0) - (rawScoreMap.get(a.track.trackId) ?? 0))
      .slice(0, 15)
      .map((item) => {
        const rawScore  = rawScoreMap.get(item.track.trackId) ?? item.laneScore;
        const selectedScore = item.laneScore;
        const sel       = selectedIdSet.has(item.track.trackId);
        const selTrack  = sel ? clusterResult.tracks.find((t) => t.trackId === item.track.trackId) : undefined;

        const selectionReason = sel
          ? "sampler_selected"
          : null;

        return {
          trackId:          item.track.trackId,
          lane:             lane.id,
          enteredLane:      lane.id,
          laneScore:        Math.round(selectedScore  * 1000) / 1000,
          rawLaneScore:     Math.round(rawScore   * 1000) / 1000,
          diversityPenalty: 0,
          clusterId:        selTrack?.clusterIds[0] ?? null,
          clusterWeight:    selTrack ? (clusterResult.clusterSelectionRatios[selTrack.clusterIds[0] ?? ""] ?? null) : null,
          selected:         sel,
          selectionReason,
          rejectionReason:  sel ? null : "cluster_entropy_cap",
        };
      });

    finalDecisionTrace.push(...traceEntries);

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
    });

    return {
      laneId: lane.id,
      tracks: clusterResult.tracks,
    };
  });

  // ── Stage 7: Adaptive cluster-aware interleaving ─────────────────────────
  const interleaverInputCount = sampledResults.reduce((sum, lane) => sum + lane.tracks.length, 0);
  const interleaved = interleaveLanes(lanes, sampledResults, targetCount);
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
  const finalTracks = interleaved.tracks.map((track) => ({
    ...track,
    clusterId: track.clusterIds[0],
  })) as Array<T & V3SelectionCandidate<T>>;
  const finalSelectionMeta = new Map<string, {
    laneId: string;
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds: string[];
  }>();
  for (const t of finalTracks) {
    finalSelectionMeta.set(t.trackId, {
      laneId: t.sourceLane,
      laneScore: t.laneScore,
      genrePrimary: t.genrePrimary,
      laneEra: t.laneEra,
      clusterIds: t.clusterIds,
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
    finalDecisionTrace.push({
      trackId: id,
      lane: meta.laneId,
      enteredLane: meta.laneId,
      laneScore: Math.round(meta.laneScore * 1000) / 1000,
      rawLaneScore: Math.round(meta.laneScore * 1000) / 1000,
      diversityPenalty: 0,
      clusterId: meta.clusterIds[0] ?? null,
      clusterWeight: null,
      selected: true,
      selectionReason: "interleaver_final",
      rejectionReason: null,
    });
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
      activePath: fallbackTriggered ? "fallback_ensemble" : "adaptive",
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

  const genreValues = Object.values(genreDist);
  const totalGenre  = genreValues.reduce((s, v) => s + v, 0) || 1;
  const genreConcentration = Math.max(...genreValues, 0) / totalGenre;
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

  const diagnostics: Record<string, unknown> = {
    pipelineVersion: "v3.1_unified_routing",
    activePath: fallbackTriggered ? "fallback_ensemble" : "adaptive",
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
    },
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
    lanes: diagnosticLaneDetails,
    laneContributions: finalLaneContributions,
    fallback: {
      triggered: fallbackTriggered,
      reason: fallbackTriggered ? "unclear_intent_multi_lane_ensemble" : "nominal",
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
  };

  return { finalTracks, diagnostics };
}
