/**
 * Playlist-level stability metrics for diagnostics.
 */

import type { TrackDecisionTrace } from "./decision-trace";
import { summariseLayerContributions } from "../scoring-engine/layer-normaliser";
import type { BiasConflictReport } from "./bias-conflict-detector";
import { computeGenreDistribution } from "../../lib/genre-coverage-enforcement";
import type { TrackGenreClassification } from "../../lib/genre-taxonomy";
import { ecosystemBalanceScore } from "../genre-intelligence/genre-ecosystems";

export interface StabilityDiagnostics {
  playlistStabilityScore: number;
  conflictReports: BiasConflictReport[];
  layerContributionSummary: Record<string, number>;
  truthAnchorDriftScore: number;
  layerDominanceWarnings: number;
  deterministicMode: boolean;
}

/**
 * Estimate stability from a single run's internal consistency.
 * Full 5-run repeatability requires caller to aggregate multiple runs.
 */
export function computePlaylistStabilityScore(opts: {
  traces: TrackDecisionTrace[];
  finalTrackIds: string[];
  classifications: Map<string, TrackGenreClassification>;
  conflictReports: BiasConflictReport[];
  truthAnchorDriftScore: number;
  sceneInfluenceRatio: number;
}): number {
  const { traces, finalTrackIds, classifications, conflictReports, truthAnchorDriftScore } =
    opts;

  let score = 1;

  const dist = computeGenreDistribution(finalTrackIds, classifications);
  const values = Object.values(dist);
  const topShare = values.length ? Math.max(...values) : 0;
  if (topShare > 0.38) score -= (topShare - 0.38) * 1.2;

  const eco = ecosystemBalanceScore(dist);
  score = score * 0.7 + eco * 0.3;

  const dominanceWarnings = traces.filter((t) => t.layerNormalisation.driftWarning).length;
  score -= Math.min(0.25, dominanceWarnings * 0.02);

  score -= Math.min(0.2, conflictReports.length * 0.04);
  score -= truthAnchorDriftScore * 0.35;

  const genreSpread = Object.keys(dist).length;
  if (genreSpread < 3) score -= 0.15;
  else if (genreSpread >= 5) score += 0.05;

  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000;
}

export function buildStabilityDiagnostics(opts: {
  traces: TrackDecisionTrace[];
  finalTrackIds: string[];
  classifications: Map<string, TrackGenreClassification>;
  conflictReports: BiasConflictReport[];
  truthAnchorDriftScore: number;
  sceneInfluenceRatio: number;
  deterministicMode: boolean;
}): StabilityDiagnostics {
  const layerContributionSummary = summariseLayerContributions(
    opts.traces.map((t) => ({
      contributions: {
        genre: t.baseGenreScore,
        scene: t.sceneContribution,
        emotion: t.emotionContribution,
        library: t.libraryContribution,
        forecast: t.forecastBoost,
        memory: t.memoryContribution,
        graph: t.graphAdjustment,
        discovery: t.discoveryBoost,
        penalty: t.penaltyAdjustments,
        sceneRouting: Math.max(0, t.sceneRoutingMultiplier - 1) * 0.12,
        ecosystem: t.ecosystemAdjustment,
      },
    }))
  );

  return {
    playlistStabilityScore: computePlaylistStabilityScore(opts),
    conflictReports: opts.conflictReports.slice(0, 12),
    layerContributionSummary,
    truthAnchorDriftScore: opts.truthAnchorDriftScore,
    layerDominanceWarnings: opts.traces.filter((t) => t.layerNormalisation.driftWarning).length,
    deterministicMode: opts.deterministicMode,
  };
}
