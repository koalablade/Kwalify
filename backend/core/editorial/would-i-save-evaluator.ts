/**
 * "Would I Save This?" evaluator — combines human playlist pattern statistics
 * with the existing human-saveability gate.
 */

import {
  evaluateHumanSaveability,
  strictModeHumanSaveability,
  type HumanSaveabilityTrack,
} from "../human-saveability-gate";
import type { SceneWorldContext } from "../scene-world-layer";
import type { LockedIntent } from "../v3/intent";
import {
  loadHumanPlaylistPatternProfile,
  scoreAgainstHumanPlaylistPatterns,
  type PatternScoringTrack,
} from "./human-playlist-patterns";
import { humanPlausibilityScore } from "./human-playlist-patterns";
import type { LibraryFingerprint } from "./library-fingerprint";
import {
  loadPreferenceModel,
  playlistPreferenceUtility,
  type PairwisePlaylistCandidate,
} from "./playlist-preference-model";

export type WouldISaveEvaluation = {
  wouldSaveScore: number;
  humanPatternScore: number;
  gateCuratorScore: number;
  combinedScore: number;
  humanSaveable: boolean;
  strictMode: boolean;
  humanPatternBreakdown: Record<string, number>;
  gateRejectionReasons: string[];
};

const MIN_COMBINED_STRICT = 0.78;
const MIN_COMBINED_RELAXED = 0.68;

/** Shared context for whole-playlist believability scoring (search, tournament, guards). */
export type PlaylistCurationScoringContext = {
  prompt: string;
  lockedIntent: LockedIntent;
  context: SceneWorldContext | null;
  libraryFingerprint?: LibraryFingerprint | null;
  targetLength: number;
};

export function playlistBelievabilityScore(
  tracks: PatternScoringTrack[],
  scoringContext: PlaylistCurationScoringContext,
): number {
  return evaluatePlaylistCurationBelievability({
    prompt: scoringContext.prompt,
    tracks,
    targetLength: scoringContext.targetLength,
    context: scoringContext.context,
    lockedIntent: scoringContext.lockedIntent,
    libraryFingerprint: scoringContext.libraryFingerprint,
  }).believabilityScore;
}

export function evaluateWouldISave(opts: {
  prompt: string;
  tracks: PatternScoringTrack[];
  context: SceneWorldContext | null;
  lockedIntent: LockedIntent;
  libraryFingerprint?: LibraryFingerprint | null;
}): WouldISaveEvaluation {
  const strict = strictModeHumanSaveability(opts.prompt, opts.lockedIntent);
  const humanPatterns = scoreAgainstHumanPlaylistPatterns(
    opts.tracks,
    loadHumanPlaylistPatternProfile(),
  );
  const plausibility = humanPlausibilityScore(opts.tracks);
  const openingPlausibility = opts.tracks.length >= 5
    ? humanPlausibilityScore(opts.tracks.slice(0, 5))
    : plausibility;

  const gate = evaluateHumanSaveability(
    opts.prompt,
    opts.tracks as HumanSaveabilityTrack[],
    opts.context,
    opts.lockedIntent,
  );

  let fingerprintBoost = 0;
  if (opts.libraryFingerprint && opts.libraryFingerprint.dominantFamilies.length > 0) {
    fingerprintBoost = Math.min(0.08, opts.libraryFingerprint.artistDiversity * 0.05);
  }

  const preferenceModel = loadPreferenceModel();
  const preferenceCandidate: PairwisePlaylistCandidate = {
    label: "candidate",
    tracks: opts.tracks,
    wouldISave: {
      wouldSaveScore: 0,
      humanPatternScore: humanPatterns.score,
      gateCuratorScore: gate.breakdown.curatorScore,
      combinedScore: 0,
      humanSaveable: gate.humanSaveable,
      strictMode: strict,
      humanPatternBreakdown: humanPatterns.breakdown,
      gateRejectionReasons: gate.rejectionReasons,
    },
    context: opts.context,
  };
  preferenceCandidate.wouldISave.combinedScore = Math.min(
    1,
    plausibility * 0.38 +
    openingPlausibility * 0.08 +
    humanPatterns.score * 0.18 +
    gate.breakdown.curatorScore * 0.28 +
    (gate.humanSaveable ? 0.04 : 0) +
    fingerprintBoost,
  );
  preferenceCandidate.wouldISave.wouldSaveScore = preferenceCandidate.wouldISave.combinedScore;

  const heuristicCombined = preferenceCandidate.wouldISave.combinedScore;
  const preferenceUtility = playlistPreferenceUtility(preferenceCandidate, preferenceModel);
  const combinedScore = Math.min(
    1,
    heuristicCombined * (1 - preferenceModel.blendWeight) +
    preferenceUtility * preferenceModel.blendWeight,
  );

  const minCombined = strict ? MIN_COMBINED_STRICT : MIN_COMBINED_RELAXED;
  const humanSaveable = gate.humanSaveable && combinedScore >= minCombined;

  return {
    wouldSaveScore: combinedScore,
    humanPatternScore: humanPatterns.score,
    gateCuratorScore: gate.breakdown.curatorScore,
    combinedScore,
    humanSaveable,
    strictMode: strict,
    humanPatternBreakdown: humanPatterns.breakdown,
    gateRejectionReasons: gate.rejectionReasons,
  };
}

export function wouldISaveCandidateScore(
  evaluation: WouldISaveEvaluation,
  trackCountRatio: number,
): number {
  const fillBonus = Math.min(0.12, trackCountRatio * 0.12);
  return evaluation.combinedScore * 0.88 + fillBonus - (evaluation.humanSaveable ? 0 : 0.25);
}

/** Playlist-level curation believability — the primary optimisation objective. */
export type PlaylistCurationBelievability = {
  believabilityScore: number;
  wouldISave: WouldISaveEvaluation;
  plausibility: number;
  humanPatternScore: number;
  fillRatio: number;
  underfillPenalty: number;
};

export function evaluatePlaylistCurationBelievability(opts: {
  prompt: string;
  tracks: PatternScoringTrack[];
  targetLength: number;
  context: SceneWorldContext | null;
  lockedIntent: LockedIntent;
  libraryFingerprint?: LibraryFingerprint | null;
}): PlaylistCurationBelievability {
  const wouldISave = evaluateWouldISave({
    prompt: opts.prompt,
    tracks: opts.tracks,
    context: opts.context,
    lockedIntent: opts.lockedIntent,
    libraryFingerprint: opts.libraryFingerprint,
  });
  const plausibility = humanPlausibilityScore(opts.tracks);
  const fillRatio = opts.tracks.length / Math.max(1, opts.targetLength);
  const underfillPenalty = Math.max(0, 1 - fillRatio) * 0.35;
  const believabilityScore = Math.min(1, wouldISave.combinedScore - underfillPenalty);

  return {
    believabilityScore,
    wouldISave,
    plausibility,
    humanPatternScore: wouldISave.humanPatternScore,
    fillRatio,
    underfillPenalty,
  };
}
