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
import type { LibraryFingerprint } from "./library-fingerprint";

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

  const combinedScore = Math.min(
    1,
    humanPatterns.score * 0.42 +
    gate.breakdown.curatorScore * 0.48 +
    fingerprintBoost +
    (gate.humanSaveable ? 0.04 : 0),
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
