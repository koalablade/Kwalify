/**
 * Observational telemetry for good-playlist-ready vs post-refinement quality.
 * Measurement only — does not influence generation.
 */

import type { PatternScoringTrack } from "../core/editorial/human-playlist-patterns";
import {
  evaluatePlaylistCurationBelievability,
  type PlaylistCurationScoringContext,
} from "../core/editorial/would-i-save-evaluator";

export type GoodPlaylistRefinementSnapshot = {
  capturedAtMs: number;
  elapsedMs: number;
  trackCount: number;
  trackIds: string[];
  averageTrackScore: number | null;
  believabilityScore: number;
  genuinelyUsable: boolean;
};

export type PlaylistSequenceDiff = {
  tracksChangedByRefinement: number;
  positionsChanged: number;
  finalWinnerDiffersFromInitial: boolean;
};

export type GoodPlaylistRefinementReport = {
  goodPlaylistReadyReached: boolean;
  goodPlaylistReadyElapsedMs: number | null;
  trackCountAtGoodPlaylistReady: number | null;
  averageConfidenceAtGoodPlaylistReady: number | null;
  averageTrackScoreAtGoodPlaylistReady: number | null;
  genuinelyUsableAtGoodPlaylistReady: boolean | null;
  confidenceAfterRefinement: number | null;
  averageTrackScoreAfterRefinement: number | null;
  believabilityAfterRefinement: number | null;
  confidenceImprovement: number | null;
  believabilityImprovement: number | null;
  tracksChangedByRefinement: number | null;
  positionsChangedByRefinement: number | null;
  finalWinnerDiffersFromInitial: boolean | null;
};

export type GoodPlaylistRefinementTelemetry = {
  captureGoodPlaylistReady(
    tracks: PatternScoringTrack[],
    scoringContext: PlaylistCurationScoringContext,
  ): void;
  finalize(
    tracks: PatternScoringTrack[],
    finalPlaylistConfidence?: number | null,
  ): GoodPlaylistRefinementReport;
};

export function minUsableTrackCount(targetLength: number): number {
  return Math.max(8, Math.ceil(targetLength * 0.72));
}

export function isGenuinelyUsablePlaylist(trackCount: number, targetLength: number): boolean {
  return trackCount >= minUsableTrackCount(targetLength);
}

function averageTrackScore(tracks: PatternScoringTrack[]): number | null {
  const scores: number[] = [];
  for (const track of tracks) {
    const raw = track as PatternScoringTrack & { score?: number; laneScore?: number };
    const value = typeof raw.score === "number"
      ? raw.score
      : typeof raw.laneScore === "number"
        ? raw.laneScore
        : null;
    if (value !== null && Number.isFinite(value)) scores.push(value);
  }
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 1000) / 1000;
}

function believabilityFor(
  tracks: PatternScoringTrack[],
  scoringContext: PlaylistCurationScoringContext,
): number {
  return Math.round(
    evaluatePlaylistCurationBelievability({
      prompt: scoringContext.prompt,
      tracks,
      targetLength: scoringContext.targetLength,
      context: scoringContext.context,
      lockedIntent: scoringContext.lockedIntent,
      libraryFingerprint: scoringContext.libraryFingerprint,
    }).believabilityScore * 1000,
  ) / 1000;
}

export function comparePlaylistSequences(initial: string[], final: string[]): PlaylistSequenceDiff {
  const maxLen = Math.max(initial.length, final.length);
  let positionsChanged = 0;
  for (let i = 0; i < maxLen; i += 1) {
    if ((initial[i] ?? null) !== (final[i] ?? null)) positionsChanged += 1;
  }
  const initialSet = new Set(initial);
  const finalSet = new Set(final);
  let symmetricDiff = 0;
  for (const id of initialSet) if (!finalSet.has(id)) symmetricDiff += 1;
  for (const id of finalSet) if (!initialSet.has(id)) symmetricDiff += 1;
  return {
    tracksChangedByRefinement: symmetricDiff,
    positionsChanged,
    finalWinnerDiffersFromInitial: initial.join("|") !== final.join("|"),
  };
}

export function createGoodPlaylistRefinementTelemetry(
  requestStartMs: number,
  targetLength: number,
): GoodPlaylistRefinementTelemetry {
  let initial: GoodPlaylistRefinementSnapshot | null = null;
  let scoringContextAtReady: PlaylistCurationScoringContext | null = null;

  return {
    captureGoodPlaylistReady(tracks, scoringContext) {
      if (initial || tracks.length === 0) return;
      scoringContextAtReady = scoringContext;
      const capturedAtMs = Date.now();
      initial = {
        capturedAtMs,
        elapsedMs: Math.max(0, capturedAtMs - requestStartMs),
        trackCount: tracks.length,
        trackIds: tracks.map((track) => track.trackId),
        averageTrackScore: averageTrackScore(tracks),
        believabilityScore: believabilityFor(tracks, scoringContext),
        genuinelyUsable: isGenuinelyUsablePlaylist(tracks.length, targetLength),
      };
    },
    finalize(tracks, finalPlaylistConfidence = null) {
      if (!initial || !scoringContextAtReady) {
        return {
          goodPlaylistReadyReached: false,
          goodPlaylistReadyElapsedMs: null,
          trackCountAtGoodPlaylistReady: null,
          averageConfidenceAtGoodPlaylistReady: null,
          averageTrackScoreAtGoodPlaylistReady: null,
          genuinelyUsableAtGoodPlaylistReady: null,
          confidenceAfterRefinement: finalPlaylistConfidence,
          averageTrackScoreAfterRefinement: averageTrackScore(tracks),
          believabilityAfterRefinement: null,
          confidenceImprovement: null,
          believabilityImprovement: null,
          tracksChangedByRefinement: null,
          positionsChangedByRefinement: null,
          finalWinnerDiffersFromInitial: null,
        };
      }

      const scoringContext = scoringContextAtReady;
      const finalIds = tracks.map((track) => track.trackId);
      const diff = comparePlaylistSequences(initial.trackIds, finalIds);
      const believabilityAfter = believabilityFor(tracks, scoringContext);
      const confidenceAfter = finalPlaylistConfidence ?? believabilityAfter;

      return {
        goodPlaylistReadyReached: true,
        goodPlaylistReadyElapsedMs: initial.elapsedMs,
        trackCountAtGoodPlaylistReady: initial.trackCount,
        averageConfidenceAtGoodPlaylistReady: initial.believabilityScore,
        averageTrackScoreAtGoodPlaylistReady: initial.averageTrackScore,
        genuinelyUsableAtGoodPlaylistReady: initial.genuinelyUsable,
        confidenceAfterRefinement: confidenceAfter,
        averageTrackScoreAfterRefinement: averageTrackScore(tracks),
        believabilityAfterRefinement: believabilityAfter,
        confidenceImprovement: Math.round((confidenceAfter - initial.believabilityScore) * 1000) / 1000,
        believabilityImprovement: Math.round((believabilityAfter - initial.believabilityScore) * 1000) / 1000,
        tracksChangedByRefinement: diff.tracksChangedByRefinement,
        positionsChangedByRefinement: diff.positionsChanged,
        finalWinnerDiffersFromInitial: diff.finalWinnerDiffersFromInitial,
      };
    },
  };
}

export type RefinementObservabilityRollup = {
  promptCount: number;
  goodPlaylistReadyReachRate: number;
  medianGoodPlaylistReadyElapsedMs: number | null;
  genuinelyUsableAtReadyRate: number | null;
  averageConfidenceImprovement: number | null;
  averageBelievabilityImprovement: number | null;
  averageTracksChangedByRefinement: number | null;
  finalWinnerDiffersRate: number | null;
};

export function rollupRefinementObservability(
  reports: Array<GoodPlaylistRefinementReport | null | undefined>,
): RefinementObservabilityRollup {
  const rows = reports.filter((row): row is GoodPlaylistRefinementReport => !!row);
  const total = rows.length || 1;
  const reached = rows.filter((row) => row.goodPlaylistReadyReached);
  const reachedWithUsability = reached.filter((row) => row.genuinelyUsableAtGoodPlaylistReady === true);
  const readyTimes = reached
    .map((row) => row.goodPlaylistReadyElapsedMs)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  const improvements = reached
    .map((row) => row.confidenceImprovement)
    .filter((value): value is number => typeof value === "number");
  const believabilityImprovements = reached
    .map((row) => row.believabilityImprovement)
    .filter((value): value is number => typeof value === "number");
  const trackChanges = reached
    .map((row) => row.tracksChangedByRefinement)
    .filter((value): value is number => typeof value === "number");
  const winnerDiffers = reached.filter((row) => row.finalWinnerDiffersFromInitial === true);

  const medianIndex = readyTimes.length > 0
    ? Math.min(readyTimes.length - 1, Math.max(0, Math.ceil(readyTimes.length * 0.5) - 1))
    : -1;

  return {
    promptCount: rows.length,
    goodPlaylistReadyReachRate: Math.round((reached.length / total) * 1000) / 10,
    medianGoodPlaylistReadyElapsedMs: medianIndex >= 0 ? readyTimes[medianIndex] ?? null : null,
    genuinelyUsableAtReadyRate: reached.length > 0
      ? Math.round((reachedWithUsability.length / reached.length) * 1000) / 10
      : null,
    averageConfidenceImprovement: improvements.length > 0
      ? Math.round((improvements.reduce((sum, value) => sum + value, 0) / improvements.length) * 1000) / 1000
      : null,
    averageBelievabilityImprovement: believabilityImprovements.length > 0
      ? Math.round((believabilityImprovements.reduce((sum, value) => sum + value, 0) / believabilityImprovements.length) * 1000) / 1000
      : null,
    averageTracksChangedByRefinement: trackChanges.length > 0
      ? Math.round((trackChanges.reduce((sum, value) => sum + value, 0) / trackChanges.length) * 10) / 10
      : null,
    finalWinnerDiffersRate: reached.length > 0
      ? Math.round((winnerDiffers.length / reached.length) * 1000) / 10
      : null,
  };
}
