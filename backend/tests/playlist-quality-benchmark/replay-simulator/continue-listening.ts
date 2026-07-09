/**
 * Continue listening score — would someone stay past the opening?
 */

import {
  computeHumanPlaylistFeatures,
  humanPlausibilityScore,
  loadHumanPlaylistPatternProfile,
} from "../../../core/editorial/human-playlist-patterns";
import type { PatternScoringTrack } from "../../../core/editorial/human-playlist-patterns";
import type { ContinueListeningResult } from "./types";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function progressionScore(tracks: PatternScoringTrack[]): number {
  const features = computeHumanPlaylistFeatures(tracks);
  const profile = loadHumanPlaylistPatternProfile();
  const jumpOk = clamp01(1 - Math.max(0, features.avgEnergyJump - profile.maxEnergyJumpP90) / 0.25);
  const slopeOk = clamp01(1 - Math.abs(features.energySlope) / 0.08);
  const smoothOk = clamp01(features.smoothTransitionShare);
  return jumpOk * 0.35 + slopeOk * 0.25 + smoothOk * 0.4;
}

function varietyScore(tracks: PatternScoringTrack[]): number {
  const features = computeHumanPlaylistFeatures(tracks);
  const profile = loadHumanPlaylistPatternProfile();
  const spacingOk = clamp01(
    1 - Math.abs(features.artistSpacingMedian - profile.artistSpacingP50) / Math.max(4, profile.artistSpacingP75),
  );
  const shareOk = clamp01(1 - Math.max(0, features.maxArtistShare - profile.maxSameArtistShare) / 0.2);
  const discoveryOk = clamp01(
    1 - Math.abs(features.discoveryRatio - profile.discoveryRatioP50) / 0.25,
  );
  return spacingOk * 0.4 + shareOk * 0.35 + discoveryOk * 0.25;
}

function endingSatisfactionScore(tracks: PatternScoringTrack[]): number {
  if (tracks.length < 8) return humanPlausibilityScore(tracks);
  const ending = tracks.slice(-Math.min(5, tracks.length));
  const endingPlausibility = humanPlausibilityScore(ending);
  const energies = ending.map((t) => t.energy ?? 0.5);
  const landing = clamp01(1 - Math.abs(energies[energies.length - 1]! - 0.48) / 0.35);
  return endingPlausibility * 0.75 + landing * 0.25;
}

export function evaluateContinueListening(opts: {
  prompt: string;
  tracks: PatternScoringTrack[];
  openingIdentity?: number;
}): ContinueListeningResult {
  if (opts.tracks.length < 5) {
    return {
      score: 0,
      openingIdentity: 0,
      consistency: 0,
      progression: 0,
      variety: 0,
      endingSatisfaction: 0,
    };
  }

  const openingIdentity = opts.openingIdentity ?? humanPlausibilityScore(opts.tracks.slice(0, 5));
  const consistency = humanPlausibilityScore(opts.tracks);
  const progression = progressionScore(opts.tracks);
  const variety = varietyScore(opts.tracks);
  const endingSatisfaction = endingSatisfactionScore(opts.tracks);

  const score = clamp01(
    openingIdentity * 0.28 +
    consistency * 0.24 +
    progression * 0.18 +
    variety * 0.15 +
    endingSatisfaction * 0.15,
  );

  return {
    score: Math.round(score * 1000) / 1000,
    openingIdentity: Math.round(openingIdentity * 1000) / 1000,
    consistency: Math.round(consistency * 1000) / 1000,
    progression: Math.round(progression * 1000) / 1000,
    variety: Math.round(variety * 1000) / 1000,
    endingSatisfaction: Math.round(endingSatisfaction * 1000) / 1000,
  };
}
