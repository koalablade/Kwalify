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
import type { TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { SampledLaneResult } from "./lane-sampler";

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
  finalTracks: T[];
  diagnostics: Record<string, unknown>;
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

    // Headroom: 2× target so cluster selector has choices
    const laneTarget = Math.max(
      Math.ceil(targetCount * lane.weight * 2),
      Math.ceil(targetCount * lane.weight) + 5,
    );

    // Stage 4: Build clusters from scored pool
    const clusteredPool = buildClusters(penalisedScored);

    // Stage 5: Entropy-constrained selection across clusters
    const clusterResult = selectFromClusters(clusteredPool, laneTarget, lane.id);

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
  const interleaved = interleaveLanes(lanes, sampledResults, targetCount);

  // ── Map back to original track objects ───────────────────────────────────
  const trackById = new Map(tracks.map((t) => [t.trackId, t]));
  const finalTracks = interleaved.tracks
    .map((t) => trackById.get(t.trackId))
    .filter((t): t is T => t !== undefined);

  // ── Stage 8: Post-hoc global diversity audit ─────────────────────────────
  let postWindow = createDiversityWindow();
  for (const t of interleaved.tracks) {
    postWindow = updateDiversityWindow(postWindow, {
      genre:  t.genrePrimary,
      era:    t.laneEra,
      artist: t.artistName,
      energy: t.energy ?? 0.50,
      lane:   t.sourceLane,
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

  const genreValues = Object.values(genreDist);
  const totalGenre  = genreValues.reduce((s, v) => s + v, 0) || 1;
  const genreConcentration = Math.max(...genreValues, 0) / totalGenre;

  // Build cluster distribution graph (genre clusters only for brevity)
  const clusterDistributionGraph: Record<string, number> = {};
  for (const ld of laneDetails) {
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
    intentDecomposition: {
      primary: decomposed.primary,
      secondaryIntents: decomposed.secondaryIntents,
      contextAnchors: decomposed.contextAnchors,
      sceneInfluenceMap: Object.fromEntries(
        Object.entries(decomposed.sceneInfluenceMap).sort((a, b) => b[1] - a[1]),
      ),
    },
    adaptiveLaneGenerator: generatorDiagnostics,
    lanes: laneDetails,
    laneContributions: interleaved.laneContributions,
    fallback: {
      triggered: fallbackTriggered,
      reason: fallbackTriggered ? "unclear_intent_multi_lane_ensemble" : "nominal",
    },

    // Cluster layer
    clusterDistributionGraph,
    aggregateClusterSpread: laneDetails.reduce(
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
    interleaverDiagnostics: interleaved.interleaverDiagnostics,

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
