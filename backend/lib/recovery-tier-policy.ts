/**
 * User-facing recovery tiers — recovery is a ladder, not the default path.
 *
 * Normal retrieval → Tier 1 → Tier 2 → Tier 3 → generic fallback (terminal)
 */

import type { RecoveryStage } from "../controllers/generation-recovery";

/** User-visible tier (1 = almost normal, 3 = last resort before generic fallback). */
export type UserRecoveryTier = 0 | 1 | 2 | 3;

export type RecoveryTierPolicy = {
  tier: UserRecoveryTier;
  label: string;
  allowWiderEra: boolean;
  allowAdjacentGenre: boolean;
  boostForgottenFavourites: boolean;
  boostSonicMatch: boolean;
  allowBroaderMood: boolean;
  allowGlobalLibrarySweep: boolean;
  allowHardSafeFill: boolean;
};

export const RECOVERY_TIER_POLICIES: Record<UserRecoveryTier, RecoveryTierPolicy> = {
  0: {
    tier: 0,
    label: "normal_retrieval",
    allowWiderEra: false,
    allowAdjacentGenre: false,
    boostForgottenFavourites: false,
    boostSonicMatch: false,
    allowBroaderMood: false,
    allowGlobalLibrarySweep: false,
    allowHardSafeFill: false,
  },
  1: {
    tier: 1,
    label: "tier_1_almost_normal",
    allowWiderEra: true,
    allowAdjacentGenre: true,
    boostForgottenFavourites: true,
    boostSonicMatch: true,
    allowBroaderMood: false,
    allowGlobalLibrarySweep: false,
    allowHardSafeFill: false,
  },
  2: {
    tier: 2,
    label: "tier_2_controlled_compromise",
    allowWiderEra: true,
    allowAdjacentGenre: true,
    boostForgottenFavourites: true,
    boostSonicMatch: true,
    allowBroaderMood: true,
    allowGlobalLibrarySweep: false,
    allowHardSafeFill: false,
  },
  3: {
    tier: 3,
    label: "tier_3_degraded_safety",
    allowWiderEra: true,
    allowAdjacentGenre: true,
    boostForgottenFavourites: true,
    boostSonicMatch: true,
    allowBroaderMood: true,
    allowGlobalLibrarySweep: true,
    allowHardSafeFill: true,
  },
};

const STAGE_TO_USER_TIER: Record<RecoveryStage, UserRecoveryTier> = {
  soft: 1,
  relaxed_scene: 2,
  deterministic: 2,
  global: 3,
  hardSafe: 3,
};

export function userTierForRecoveryStage(stage: RecoveryStage): UserRecoveryTier {
  return STAGE_TO_USER_TIER[stage] ?? 1;
}

export function recoveryStageAllowedForTier(
  tier: UserRecoveryTier,
  stage: RecoveryStage,
): boolean {
  const policy = RECOVERY_TIER_POLICIES[tier];
  if (stage === "soft") return tier >= 1;
  if (stage === "relaxed_scene" || stage === "deterministic") return tier >= 2 && policy.allowBroaderMood;
  if (stage === "global") return tier >= 3 && policy.allowGlobalLibrarySweep;
  if (stage === "hardSafe") return tier >= 3 && policy.allowHardSafeFill;
  return false;
}

export function nextRecoveryTier(current: UserRecoveryTier): UserRecoveryTier {
  return Math.min(3, current + 1) as UserRecoveryTier;
}

export function tierRelaxationCode(tier: UserRecoveryTier): string {
  return `recovery_tier_${tier}`;
}
