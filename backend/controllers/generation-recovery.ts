import {
  capArtistAlbumRelaxation,
  minimumGenreEvidenceInTail,
  narrowSceneDiversityPressure,
  recoveryIntentPreCheck,
  type DominantIntentContract,
} from "../core/dominant-intent-contract";
import type { ValidCandidateSupply } from "../lib/library-valid-candidate-supply";

export type RecoveryGuardResult = {
  proceed: boolean;
  controlledFailure: boolean;
  reason: string | null;
  diversityPressureMultiplier: number;
  artistRelaxAllowed: boolean;
  albumRelaxAllowed: boolean;
  tailGenreEvidence: { satisfied: boolean; tailEvidenceRatio: number };
};

export type RecoveryStage = "soft" | "relaxed_scene" | "deterministic" | "global" | "hardSafe";

/** Recovery tiers — higher tiers only when lower tiers cannot fill the playlist. */
export type RecoveryTierLevel = 0 | 1 | 2 | 3 | 4;

export const RECOVERY_TIER_ORDER: RecoveryStage[] = [
  "soft",
  "relaxed_scene",
  "deterministic",
  "global",
  "hardSafe",
];

export function recoveryTierForStage(stage: RecoveryStage): RecoveryTierLevel {
  const index = RECOVERY_TIER_ORDER.indexOf(stage);
  return (index >= 0 ? index : 0) as RecoveryTierLevel;
}

export function recoveryStageAllowed(
  guards: RecoveryGuardResult,
  stage: RecoveryStage,
): { allowed: boolean; reason: string | null } {
  if (guards.controlledFailure && (stage === "global" || stage === "hardSafe" || stage === "relaxed_scene")) {
    return { allowed: false, reason: guards.reason ?? "controlled_recovery_failure" };
  }
  if (!guards.proceed && stage !== "soft") {
    return { allowed: false, reason: guards.reason ?? "recovery_blocked_preserve_intent" };
  }
  if (!guards.tailGenreEvidence.satisfied && stage === "global" && guards.reason) {
    return { allowed: false, reason: "tail_genre_evidence_insufficient" };
  }
  return { allowed: true, reason: null };
}

export function effectiveRecoveryArtistLimit(
  baseLimit: number,
  guards: RecoveryGuardResult,
): number {
  if (!guards.artistRelaxAllowed) return Math.max(1, baseLimit - 1);
  const scaled = Math.ceil(baseLimit * Math.max(0.5, guards.diversityPressureMultiplier));
  return Math.max(1, scaled);
}

export function evaluateRecoveryGuards(
  contract: DominantIntentContract,
  opts: {
    currentEmotionSurvival?: number;
    currentSubgenreSurvival?: number;
    fallbackLevel: "none" | "family" | "adjacent" | "global" | "soft" | "hardSafe";
    underfillRatio: number;
    finalTracks: Array<{ genreFamily?: string | null; genrePrimary?: string | null }>;
    expectedFamilies: string[];
    validCandidateSupply?: ValidCandidateSupply | null;
  },
): RecoveryGuardResult {
  const preCheck = recoveryIntentPreCheck(contract, {
    currentEmotionSurvival: opts.currentEmotionSurvival,
    currentSubgenreSurvival: opts.currentSubgenreSurvival,
    fallbackLevel: opts.fallbackLevel,
    underfillRatio: opts.underfillRatio,
  });

  const relaxCaps = capArtistAlbumRelaxation(contract.mode);
  const tailGenreEvidence = minimumGenreEvidenceInTail(opts.finalTracks, opts.expectedFamilies);
  const supply = opts.validCandidateSupply ?? null;
  const severeUnderfill = opts.underfillRatio < 0.2;
  const supplyCanFill = !!supply && supply.recoveryValidCount >= supply.minRequired;
  const supplyOverride = severeUnderfill && supplyCanFill;

  return {
    proceed: preCheck.allowed || supplyOverride,
    controlledFailure: supplyOverride ? false : preCheck.controlledFailureRecommended,
    reason: supplyOverride
      ? null
      : preCheck.reason,
    diversityPressureMultiplier: narrowSceneDiversityPressure(contract.scene),
    artistRelaxAllowed: relaxCaps.allowArtistRelax || supplyOverride,
    albumRelaxAllowed: relaxCaps.allowAlbumRelax || supplyOverride,
    tailGenreEvidence,
  };
}
