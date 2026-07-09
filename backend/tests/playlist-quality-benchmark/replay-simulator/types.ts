/**
 * Replay simulation types — behavioral proxy metrics (evaluation only).
 */

import type { PatternScoringTrack } from "../../../core/editorial/human-playlist-patterns";

export type OpeningRetentionResult = {
  score: number;
  firstTrackFit: number;
  firstFiveCoherence: number;
  earlyEnergyMismatch: number;
  genreShock: number;
  flags: string[];
};

export type SkipRiskResult = {
  score: number;
  firstThreeSkipRisk: number;
  flags: string[];
};

export type ContinueListeningResult = {
  score: number;
  openingIdentity: number;
  consistency: number;
  progression: number;
  variety: number;
  endingSatisfaction: number;
};

export type SaveProxyResult = {
  score: number;
  intentMatch: number;
  replayUsefulness: number;
  playlistIdentity: number;
  emotionalMemorability: number;
};

export type PlaylistReplaySimulation = {
  openingRetention: OpeningRetentionResult;
  skipRisk: SkipRiskResult;
  continueListening: ContinueListeningResult;
  saveProxy: SaveProxyResult;
  /** Estimated survival through real listening (>10 min proxy). Higher is better. */
  replayProxyScore: number;
  /** Probability-style skip risk in first third of playlist. Higher is worse. */
  skipRiskScore: number;
  /** Estimated save/follow likelihood. Higher is better. */
  saveProxyScore: number;
  continueListeningScore: number;
  trackCount: number;
};

export type ReplaySimulationInput = {
  prompt: string;
  tracks: PatternScoringTrack[];
};
