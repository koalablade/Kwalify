/**
 * Playlist replay simulation — behavioral retention proxy (evaluation only).
 *
 * Does NOT feed scores into generation or scoring weights.
 */

import { evaluateContinueListening } from "./continue-listening";
import { evaluateOpeningRetention } from "./opening-retention";
import { evaluateSaveProxy } from "./save-proxy";
import { evaluateSkipRisk } from "./skip-risk";
import type { PlaylistReplaySimulation, ReplaySimulationInput } from "./types";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function simulatePlaylistReplay(input: ReplaySimulationInput): PlaylistReplaySimulation | null {
  if (input.tracks.length < 5) return null;

  const openingRetention = evaluateOpeningRetention(input);
  const skipRisk = evaluateSkipRisk({
    prompt: input.prompt,
    tracks: input.tracks,
    weakOpenerScore: openingRetention.firstTrackFit,
  });

  const continueListening = evaluateContinueListening({
    prompt: input.prompt,
    tracks: input.tracks,
    openingIdentity: openingRetention.firstFiveCoherence,
  });

  const saveProxy = evaluateSaveProxy({
    prompt: input.prompt,
    tracks: input.tracks,
    continueListeningScore: continueListening.score,
    openingIdentity: openingRetention.firstFiveCoherence,
  });

  const continueListeningScore = continueListening.score;
  const skipRiskScore = skipRisk.score;
  const saveProxyScore = saveProxy.score;

  /** >10 min listening proxy: survive opening, low early skip risk, coherent continuation. */
  const replayProxyScore = clamp01(
    openingRetention.score * 0.3 +
    (1 - skipRisk.firstThreeSkipRisk) * 0.3 +
    continueListeningScore * 0.25 +
    saveProxyScore * 0.15,
  );

  return {
    openingRetention,
    skipRisk,
    continueListening,
    saveProxy,
    replayProxyScore: Math.round(replayProxyScore * 1000) / 1000,
    skipRiskScore: Math.round(skipRiskScore * 1000) / 1000,
    saveProxyScore: Math.round(saveProxyScore * 1000) / 1000,
    continueListeningScore: Math.round(continueListeningScore * 1000) / 1000,
    trackCount: input.tracks.length,
  };
}

export type { PlaylistReplaySimulation, ReplaySimulationInput } from "./types";
