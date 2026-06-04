/**
 * Per-track decision trace — explains which layer moved the score.
 */

import type { TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { TrackScoringDebug } from "../../lib/hybrid-scoring";
import {
  SCORING_WEIGHTS,
  MAX_SCENE_SCORE_INFLUENCE,
} from "../genre-intelligence/genre-constraints";
import type { LayerContributions } from "../scoring-engine/layer-normaliser";
import {
  normaliseLayerContributions,
  type LayerNormaliseResult,
} from "../scoring-engine/layer-normaliser";
import type { PreScoreBiasBreakdown } from "../genre-intelligence/pre-score-bias";

export interface TrackDecisionTrace {
  trackId: string;
  genreFamily: string;
  baseGenreScore: number;
  sceneContribution: number;
  emotionContribution: number;
  libraryContribution: number;
  memoryContribution: number;
  forecastBoost: number;
  graphAdjustment: number;
  sceneRoutingMultiplier: number;
  penaltyAdjustments: number;
  discoveryBoost: number;
  ecosystemAdjustment: number;
  truthAnchorDrift: number;
  finalScore: number;
  rejectionReasons: string[];
  layerNormalisation: Pick<
    LayerNormaliseResult,
    "dominantLayer" | "dominanceShare" | "rebalanceApplied" | "driftWarning"
  >;
}

export interface BuildTrackTraceInput {
  trackId: string;
  classification: TrackGenreClassification;
  hybridDebug: TrackScoringDebug | null;
  triRaw?: {
    sceneScore: number;
    libraryFitScore: number;
    genreBalanceScore: number;
    emotionMatch: number;
  };
  preScore?: PreScoreBiasBreakdown;
  postScore?: {
    rediscoveryDelta: number;
    referenceDelta: number;
    freshnessMult: number;
    confidenceMult: number;
  };
  poolBias?: {
    coverageDelta: number;
    ecosystemDelta: number;
  };
  truthAnchorDrift?: number;
  finalScore: number;
  rejected?: string | null;
}

export function buildTrackDecisionTrace(input: BuildTrackTraceInput): TrackDecisionTrace {
  const tri = input.triRaw ?? {
    sceneScore: input.hybridDebug?.sceneScore ?? 0,
    libraryFitScore: input.hybridDebug?.libraryFitScore ?? 0,
    genreBalanceScore: input.hybridDebug?.genreMatch ?? 0,
    emotionMatch: input.hybridDebug?.emotionMatch ?? 0,
  };

  // V10: 3-channel scoring — semantic 45%, emotion 25%, scene 30%
  const sceneContribution =
    Math.min(tri.sceneScore, MAX_SCENE_SCORE_INFLUENCE) * SCORING_WEIGHTS.scene;
  const emotionContribution = tri.emotionMatch * SCORING_WEIGHTS.emotion;
  // V10: library and genre are not scoring factors — reported as 0 in trace
  const libraryContribution = 0;
  const baseGenreScore = 0;

  const pre = input.preScore;
  const forecastBoost = pre?.forecastComponent ?? 0;
  const graphAdjustment = pre?.graphComponent ?? 0;
  const memoryContribution =
    (input.hybridDebug?.memoryMatch ?? 0) * 0.08 + (pre?.memoryComponent ?? 0);
  const sceneRoutingMultiplier = pre?.sceneRoutingMultiplier ?? 1;
  const penaltyAdjustments = pre?.softPenaltyComponent ?? 0;

  const post = input.postScore;
  const discoveryBoost =
    (post?.rediscoveryDelta ?? 0) + (post?.referenceDelta ?? 0);
  const ecosystemAdjustment = input.poolBias?.ecosystemDelta ?? 0;
  const poolCoverage = input.poolBias?.coverageDelta ?? 0;

  const contributions: LayerContributions = {
    genre: baseGenreScore,
    scene: sceneContribution,
    emotion: emotionContribution,
    library: libraryContribution,
    forecast: forecastBoost,
    memory: memoryContribution,
    graph: graphAdjustment,
    discovery: discoveryBoost,
    penalty: penaltyAdjustments + poolCoverage,
    sceneRouting: Math.max(0, sceneRoutingMultiplier - 1) * 0.12,
    ecosystem: ecosystemAdjustment,
  };

  const layerNormalisation = normaliseLayerContributions(contributions, { rebalance: false });

  return {
    trackId: input.trackId,
    genreFamily: input.classification.genreFamily,
    baseGenreScore: round(baseGenreScore),
    sceneContribution: round(sceneContribution),
    emotionContribution: round(emotionContribution),
    libraryContribution: round(libraryContribution),
    memoryContribution: round(memoryContribution),
    forecastBoost: round(forecastBoost),
    graphAdjustment: round(graphAdjustment),
    sceneRoutingMultiplier: round(sceneRoutingMultiplier),
    penaltyAdjustments: round(penaltyAdjustments + poolCoverage),
    discoveryBoost: round(discoveryBoost),
    ecosystemAdjustment: round(ecosystemAdjustment),
    truthAnchorDrift: round(input.truthAnchorDrift ?? 0),
    finalScore: round(input.finalScore),
    rejectionReasons: input.rejected ? [input.rejected] : [],
    layerNormalisation: {
      dominantLayer: layerNormalisation.dominantLayer,
      dominanceShare: layerNormalisation.dominanceShare,
      rebalanceApplied: layerNormalisation.rebalanceApplied,
      driftWarning: layerNormalisation.driftWarning,
    },
  };
}

export function buildPlaylistTraceSummary(traces: TrackDecisionTrace[]): {
  topTracks: TrackDecisionTrace[];
  layerDominanceWarnings: number;
} {
  const topTracks = [...traces]
    .filter((t) => t.rejectionReasons.length === 0)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 12);
  const layerDominanceWarnings = traces.filter((t) => t.layerNormalisation.driftWarning).length;
  return { topTracks, layerDominanceWarnings };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
