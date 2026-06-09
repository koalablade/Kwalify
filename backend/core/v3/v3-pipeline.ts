/**
 * V3.1+ Pipeline Orchestrator — Unified Routing System
 *
 * Replaces the V3 "score → sort → pick" implicit flow with an explicit
 * multi-stage decision pipeline:
 *
 *   1. Intent decomposition           (multi-axis, unchanged from V3)
 *   2. Adaptive lane generation       (NEW — dynamic, probabilistic)
 *   3. Candidate scoring per lane     (unchanged per-lane scorer)
 *   4. Cluster formation              (NEW — groups before selection)
 *   5. Entropy-constrained selection  (NEW — cluster-spread enforced)
 *   6. Global diversity penalties     (NEW — soft multipliers on scores)
 *   7. Adaptive cluster-aware interleaving (UPGRADED)
 *   8. Global diversity correction pass (post-hoc diagnostics only)
 *
 * The V3 fallback ensemble (buildFallbackLanes) is preserved and used when
 * the adaptive generator also detects unclear intent.
 */

import type { EmotionProfile } from "../../lib/emotion";
import { decomposeIntent, isUnclearIntent } from "./intent-decomposer";
import { buildLanes } from "./lane-router";
import { generateAdaptiveLanes } from "./adaptive-lane-generator";
import { scoreLane } from "./lane-scorer";
import { buildClusters, selectFromClusters } from "./cluster-candidate-engine";
import {
  createDiversityWindow,
  updateDiversityWindow,
  computeDiversityMetrics,
  applyDiversityPenalties,
  computeAdjustedLaneWeights,
} from "./global-diversity-controller";
import { interleaveLanes } from "./interleaver";
import { applyQualityLock, type QualityLockRecord } from "./quality-lock";
import type { TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { SampledLaneResult } from "./lane-sampler";
import type { EraBucket } from "../../lib/intent-parser";
import type { V3MetadataTrack, V3TrackMetadata } from "../../lib/v3-track-contract";

// ── Types ───────────────────────────────────────────────────────────────────

export interface V3PipelineTrack {
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

type ValidatedSampledLaneResult<T extends V3PipelineTrack> = {
  laneId: string;
  tracks: V3SelectionCandidate<T>[];
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

function resolveCandidateGenre(
  trackId: string,
  existing: string | undefined,
  opts: {
    genreByTrack?: (trackId: string) => string;
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): string {
  const classified = opts.classificationByTrack?.(trackId)?.genrePrimary;
  if (classified && classified !== "unknown") return classified;
  if (existing && existing.trim()) return existing;
  return opts.genreByTrack?.(trackId) ?? "unknown";
}

function hasRequiredSelectionMetadata<T extends V3PipelineTrack>(
  candidate: Partial<V3SelectionCandidate<T>>,
  opts: {
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): candidate is V3SelectionCandidate<T> {
  const classification = candidate.trackId
    ? opts.classificationByTrack?.(candidate.trackId)
    : undefined;
  const genreValid =
    typeof candidate.genrePrimary === "string" &&
    candidate.genrePrimary.trim().length > 0 &&
    !(classification && classification.genrePrimary !== "unknown" && candidate.genrePrimary === "unknown");
  return (
    typeof candidate.sourceLane === "string" &&
    candidate.sourceLane.trim().length > 0 &&
    Number.isFinite(candidate.laneScore) &&
    genreValid &&
    Array.isArray(candidate.clusterIds) &&
    candidate.clusterIds.length > 0
  );
}

function repairSelectionCandidate<T extends V3PipelineTrack>(
  candidate: T & {
    sourceLane?: string;
    laneScore?: number;
    genrePrimary?: string;
    laneEra?: EraBucket;
    clusterIds?: string[];
  },
  lane: ReturnType<typeof buildLanes>[number],
  decomposed: ReturnType<typeof decomposeIntent>,
  opts: {
    genreByTrack?: (trackId: string) => string;
    noveltyByTrack?: (trackId: string) => number;
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): V3SelectionCandidate<T> | null {
  const genre = resolveCandidateGenre(candidate.trackId, candidate.genrePrimary, opts);
  const rescored = scoreLane([candidate], lane, decomposed, {
    genreByTrack: (trackId) =>
      trackId === candidate.trackId ? genre : (opts.genreByTrack?.(trackId) ?? "unknown"),
    noveltyByTrack: opts.noveltyByTrack,
  })[0];
  if (!rescored) return null;

  const scoredForCluster = {
    ...rescored,
    genrePrimary: genre,
  };
  const clustered = buildClusters([scoredForCluster]);
  const clusterIds = clustered.trackToClusterIds.get(candidate.trackId) ?? [];
  const repaired: V3SelectionCandidate<T> = {
    ...candidate,
    sourceLane: lane.id,
    laneScore: Number.isFinite(candidate.laneScore) ? candidate.laneScore! : rescored.laneScore,
    genrePrimary: genre,
    laneEra: candidate.laneEra ?? rescored.era,
    clusterIds,
    clusterId: clusterIds[0],
  };
  return hasRequiredSelectionMetadata(repaired, opts) ? repaired : null;
}

function validateSelectionCandidates<T extends V3PipelineTrack>(
  sampledResults: SampledLaneResult<T>[],
  lanes: ReturnType<typeof buildLanes>,
  decomposed: ReturnType<typeof decomposeIntent>,
  opts: {
    genreByTrack?: (trackId: string) => string;
    noveltyByTrack?: (trackId: string) => number;
    classificationByTrack?: (trackId: string) => TrackGenreClassification | undefined;
  },
): { sampledResults: ValidatedSampledLaneResult<T>[]; repairedCount: number; droppedCount: number } {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  let repairedCount = 0;
  let droppedCount = 0;

  const validated = sampledResults.map((sampled) => {
    const lane = laneById.get(sampled.laneId);
    if (!lane) {
      droppedCount += sampled.tracks.length;
      return { laneId: sampled.laneId, tracks: [] };
    }

    const tracks: V3SelectionCandidate<T>[] = [];
    for (const candidate of sampled.tracks) {
      const withLane = {
        ...candidate,
        sourceLane: candidate.sourceLane ?? sampled.laneId,
        genrePrimary: resolveCandidateGenre(candidate.trackId, candidate.genrePrimary, opts),
      };
      if (hasRequiredSelectionMetadata(withLane, opts)) {
        tracks.push(withLane);
        continue;
      }

      const repaired = repairSelectionCandidate(withLane, lane, decomposed, opts);
      if (repaired) {
        repairedCount++;
        tracks.push(repaired);
      } else {
        droppedCount++;
      }
    }

    return { laneId: sampled.laneId, tracks };
  });

  return { sampledResults: validated, repairedCount, droppedCount };
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
  } = {},
): V3PipelineResult<T> {

  // ── Stage 1: Multi-axis intent decomposition ─────────────────────────────
  const decomposed = decomposeIntent(vibe, profile);
  const fallbackTriggered = isUnclearIntent(decomposed);

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

  let diversityWindow = createDiversityWindow();

  const sampledResults: SampledLaneResult<T>[] = lanes.map((lane) => {
    // Stage 3: Score every track for this lane
    const rawScored = scoreLane(tracks, lane, decomposed, {
      genreByTrack: opts.genreByTrack,
      noveltyByTrack: opts.noveltyByTrack,
    });

    // Stage 6a: Apply diversity penalties based on rolling window
    const { scoredTracks: penalisedScored } = applyDiversityPenalties(
      rawScored,
      diversityWindow,
      opts.genreByTrack ?? (() => "unknown"),
    );

    // Headroom: 3× target so cluster selector has choices after Stage 6b reweights
    const laneTarget = Math.max(
      Math.ceil(targetCount * lane.weight * 3),
      Math.ceil(targetCount * lane.weight) + 10,
    );

    // Stage 4: Build clusters from scored pool
    const clusteredPool = buildClusters(penalisedScored);

    // Stage 5: Entropy-constrained selection across clusters
    const clusterResult = selectFromClusters(clusteredPool, laneTarget, lane.id);

    // Capture window state BEFORE update — used for per-dimension penalty trace
    const windowBeforeLane = diversityWindow;
    const laneWindowMetrics = computeDiversityMetrics(windowBeforeLane);

    // Update diversity window for subsequent lanes
    for (const t of clusterResult.tracks.slice(0, 4)) {
      diversityWindow = updateDiversityWindow(diversityWindow, {
        genre:  t.genrePrimary,
        era:    t.laneEra,
        artist: t.artistName,
        energy: t.energy ?? 0.50,
        lane:   lane.id,
      });
    }

    // ── Observability: build per-track trace (top 15 by raw score) ───────────
    const selectedIdSet = new Set(clusterResult.tracks.map((t) => t.trackId));
    const rawScoreMap   = new Map(rawScored.map((r) => [r.track.trackId, r.laneScore]));

    const traceEntries = [...penalisedScored]
      .sort((a, b) => (rawScoreMap.get(b.track.trackId) ?? 0) - (rawScoreMap.get(a.track.trackId) ?? 0))
      .slice(0, 15)
      .map((item) => {
        const rawScore  = rawScoreMap.get(item.track.trackId) ?? item.laneScore;
        const penScore  = item.laneScore;
        const sel       = selectedIdSet.has(item.track.trackId);
        const totalPenalty = rawScore > 0 ? Math.max(0, 1 - penScore / rawScore) : 0;
        const selTrack  = sel ? clusterResult.tracks.find((t) => t.trackId === item.track.trackId) : undefined;

        // Per-dimension penalty breakdown (mirrors logic in applyDiversityPenalties)
        const genre        = opts.genreByTrack?.(item.track.trackId) ?? "unknown";
        const artistRepeats = windowBeforeLane.artistWindow.filter((a) => a === item.track.artistName).length;
        const genrePenalty   = (laneWindowMetrics.dominantGenre === genre && laneWindowMetrics.genreConcentration > 0.55)
          ? Math.round((1 - 0.65) * 1000) / 1000 : 0;
        const eraPenalty     = (laneWindowMetrics.dominantEra === (item as unknown as Record<string, unknown>)["era"] && laneWindowMetrics.eraConcentration > 0.35)
          ? Math.round((1 - 0.75) * 1000) / 1000 : 0;
        const artistPenalty  = artistRepeats >= 2
          ? Math.round((1 - 0.55) * 1000) / 1000 : 0;

        const selectionReason = sel
          ? (totalPenalty === 0 ? "high_lane_score_cluster_selected" : "penalised_but_cluster_selected")
          : null;

        return {
          trackId:          item.track.trackId,
          lane:             lane.id,
          enteredLane:      lane.id,
          laneScore:        Math.round(penScore  * 1000) / 1000,
          rawLaneScore:     Math.round(rawScore   * 1000) / 1000,
          diversityPenalty: Math.round(totalPenalty * 1000) / 1000,
          genrePenalty,
          artistPenalty,
          eraPenalty,
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
      selectedCount: clusterResult.tracks.length,
      clusterSpread: clusterResult.clusterSpread as unknown as Record<string, number>,
      clusterSelectionRatios: clusterResult.clusterSelectionRatios,
    });

    return {
      laneId: lane.id,
      tracks: clusterResult.tracks,
    };
  });

  const validation = validateSelectionCandidates(sampledResults, lanes, decomposed, {
    genreByTrack: opts.genreByTrack,
    noveltyByTrack: opts.noveltyByTrack,
    classificationByTrack: opts.classificationByTrack,
  });
  const validatedSampledResults = validation.sampledResults;

  // ── Stage 6b: Compute diversity metrics for potential lane reweight ───────
  const preDiversityMetrics = computeDiversityMetrics(diversityWindow);
  const adjustedLaneWeights = computeAdjustedLaneWeights(
    Object.fromEntries(lanes.map((l) => [l.id, l.weight])),
    preDiversityMetrics,
  );
  for (const lane of lanes) {
    if (adjustedLaneWeights[lane.id] !== undefined) {
      lane.weight = adjustedLaneWeights[lane.id]!;
    }
  }

  // ── Stage 7: Adaptive cluster-aware interleaving ─────────────────────────
  const interleaved = interleaveLanes(lanes, validatedSampledResults, targetCount);
  const qualityLockTracks = interleaved.tracks.filter((track) =>
    hasRequiredSelectionMetadata(track, opts)
  );

  // ── Stage 7.5: Quality Lock Layer ────────────────────────────────────────
  // Build a unified candidate pool from all lane outputs, excluding tracks
  // already chosen by the interleaver. Pool is sorted by laneScore desc so the
  // quality lock always refills with the highest-value available candidate.
  const interleavedIds = new Set(qualityLockTracks.map((t) => t.trackId));
  const finalSelectionMeta = new Map<string, {
    laneId: string;
    laneScore: number;
    genrePrimary: string;
    laneEra: EraBucket;
    clusterIds: string[];
  }>();
  for (const t of qualityLockTracks) {
    finalSelectionMeta.set(t.trackId, {
      laneId: t.sourceLane,
      laneScore: t.laneScore,
      genrePrimary: t.genrePrimary,
      laneEra: t.laneEra,
      clusterIds: t.clusterIds,
    });
  }
  const poolMap = new Map<string, QualityLockRecord>();
  for (const sl of validatedSampledResults) {
    for (const t of sl.tracks) {
      if (interleavedIds.has(t.trackId)) continue;
      const existing = poolMap.get(t.trackId);
      if (!existing || existing.laneScore < t.laneScore) {
        finalSelectionMeta.set(t.trackId, {
          laneId: t.sourceLane,
          laneScore: t.laneScore,
          genrePrimary: t.genrePrimary,
          laneEra: t.laneEra,
          clusterIds: t.clusterIds,
        });
        poolMap.set(t.trackId, {
          trackId:      t.trackId,
          artistName:   t.artistName,
          energy:       t.energy,
          valence:      t.valence,
          sourceLane:   t.sourceLane,
          laneScore:    t.laneScore,
          genrePrimary: t.genrePrimary,
          laneEra:      t.laneEra,
          clusterIds:   t.clusterIds,
        });
      }
    }
  }
  const qualityLockPool = [...poolMap.values()].sort((a, b) => b.laneScore - a.laneScore);

  const lockResult = applyQualityLock(
    qualityLockTracks.map((t) => ({
      trackId:      t.trackId,
      artistName:   t.artistName,
      energy:       t.energy,
      valence:      t.valence,
      sourceLane:   t.sourceLane,
      laneScore:    t.laneScore,
      genrePrimary: t.genrePrimary,
      laneEra:      t.laneEra,
      clusterIds:   t.clusterIds,
    })),
    qualityLockPool,
    {
      targetCount,
      vibe,
      sceneInfluenceMap: decomposed.sceneInfluenceMap as Record<string, number>,
      targetEnergy:  profile.energy  ?? 0.65,
      targetValence: profile.valence ?? 0.70,
    },
  );

  // ── Map back to original track objects ───────────────────────────────────
  const trackById = new Map(tracks.map((t) => [t.trackId, t]));
  const finalTracks = lockResult.trackIds
    .map((id) => {
      const original = trackById.get(id);
      const meta = finalSelectionMeta.get(id);
      if (!original || !meta || meta.clusterIds.length === 0) return null;
      return {
        ...original,
        sourceLane: meta.laneId,
        laneScore: meta.laneScore,
        genrePrimary: meta.genrePrimary,
        laneEra: meta.laneEra,
        clusterIds: meta.clusterIds,
        clusterId: meta.clusterIds[0],
      } as T & V3SelectionCandidate<T>;
    })
    .filter((t): t is T & V3SelectionCandidate<T> => t !== null);

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
      trace.selectionReason = trace.selectionReason ?? "quality_lock_final";
      trace.rejectionReason = null;
      continue;
    }
    if (trace.selected) {
      trace.selected = false;
      trace.selectionReason = null;
      trace.rejectionReason = "quality_lock_removed";
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
      selectionReason: "quality_lock_final",
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
  for (const t of interleaved.tracks) {
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
    qualityLock: lockResult.diagnostics,
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
    candidateValidation: {
      repairedCount: validation.repairedCount,
      droppedCount: validation.droppedCount,
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
      preInterleave: {
        genreConcentration:   preDiversityMetrics.genreConcentration,
        eraConcentration:     preDiversityMetrics.eraConcentration,
        artistRepeatIndex:    preDiversityMetrics.artistRepeatIndex,
        laneSaturation:       preDiversityMetrics.laneSaturation,
        driftState:           preDiversityMetrics.driftState,
        clusterCollapseIndex: preDiversityMetrics.clusterCollapseIndex,
        explorationPressure:  preDiversityMetrics.explorationPressure,
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
