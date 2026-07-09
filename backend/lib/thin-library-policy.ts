/**
 * Thin-library policy — honest UX when library supply cannot reach requested length.
 *
 * Option B (insufficient): maxAchievable < 3 → LIBRARY_INSUFFICIENT_FOR_PROMPT
 * Option A (honest partial): maxAchievable < requested * 0.67 → cap delivery + message
 * Normal: otherwise
 */

import type { ThinLibraryDiagnostics, ThinLibraryIntentSupply, EraConstraintInput } from "./thin-library-intent-supply";
export { hasEraConstraint, type EraConstraintInput } from "./thin-library-intent-supply";

export const THIN_LIBRARY_INSUFFICIENT_THRESHOLD = 3;
export const THIN_LIBRARY_PARTIAL_RATIO = 0.67;

export type ThinLibraryPolicyAction = "normal" | "insufficient" | "honest_partial";

export type ThinLibraryPolicyResult = {
  action: ThinLibraryPolicyAction;
  maxAchievable: number;
  requestedLength: number;
  targetLength: number;
  partialRatio: number;
  userMessage: string | null;
  reason: string;
  diagnostics: ThinLibraryDiagnostics;
};

export function evaluateThinLibraryPolicy(
  intentSupply: ThinLibraryIntentSupply,
): ThinLibraryPolicyResult {
  const maxAchievable = intentSupply.maxAchievable;
  const requested = intentSupply.requestedLength;
  const partialThreshold = Math.ceil(requested * THIN_LIBRARY_PARTIAL_RATIO);
  const diagnostics: ThinLibraryDiagnostics = {
    requestedLength: requested,
    strictSupply: intentSupply.strictSupply,
    adjacentSupply: intentSupply.adjacentSupply,
    intentPreservingSupply: intentSupply.intentPreservingSupply,
    relaxedSupply: intentSupply.relaxedSupply,
    excludedRelaxedSupply: intentSupply.excludedRelaxedSupply,
    recoverySupply: intentSupply.recoverySupply,
    maxAchievableReason: intentSupply.maxAchievableReason,
  };

  if (maxAchievable < THIN_LIBRARY_INSUFFICIENT_THRESHOLD) {
    return {
      action: "insufficient",
      maxAchievable,
      requestedLength: requested,
      targetLength: maxAchievable,
      partialRatio: maxAchievable / Math.max(1, requested),
      userMessage: buildThinLibraryInsufficientMessage(maxAchievable, requested),
      reason: "max_achievable_below_insufficient_threshold",
      diagnostics,
    };
  }

  if (maxAchievable < partialThreshold) {
    return {
      action: "honest_partial",
      maxAchievable,
      requestedLength: requested,
      targetLength: maxAchievable,
      partialRatio: maxAchievable / Math.max(1, requested),
      userMessage: buildThinLibraryHonestPartialMessage(maxAchievable, requested),
      reason: "max_achievable_below_partial_ratio",
      diagnostics,
    };
  }

  return {
    action: "normal",
    maxAchievable,
    requestedLength: requested,
    targetLength: requested,
    partialRatio: 1,
    userMessage: null,
    reason: "supply_adequate",
    diagnostics,
  };
}

export function buildThinLibraryInsufficientMessage(maxAchievable: number, requested: number): string {
  const trackWord = maxAchievable === 1 ? "track" : "tracks";
  if (maxAchievable <= 0) {
    return `Your library does not have enough high-confidence matches for this prompt (requested ${requested} tracks).`;
  }
  return `Your library has only about ${maxAchievable} matching ${trackWord} for this prompt — not enough for a playlist (requested ${requested}).`;
}

export function buildThinLibraryHonestPartialMessage(maxAchievable: number, requested: number): string {
  return `Your library can support about ${maxAchievable} of ${requested} requested tracks for this prompt. Publishing the best verified matches.`;
}

export function effectiveFinalizeRequestedLength(
  requestedLength: number,
  policy: ThinLibraryPolicyResult,
): number {
  if (policy.action === "honest_partial" || policy.action === "insufficient") {
    return Math.min(requestedLength, Math.max(policy.targetLength, policy.maxAchievable));
  }
  return requestedLength;
}

export function resolveThinLibraryMinBestAvailableCount(
  requestedLength: number,
  policy: ThinLibraryPolicyResult,
): number {
  if (policy.action === "honest_partial") {
    const cap = effectiveFinalizeRequestedLength(requestedLength, policy);
    return Math.min(cap, Math.max(1, Math.ceil(cap * THIN_LIBRARY_PARTIAL_RATIO)));
  }
  if (policy.action === "insufficient") {
    return Math.max(1, policy.maxAchievable);
  }
  return Math.min(requestedLength, Math.max(5, Math.ceil(requestedLength * 0.4)));
}

export function shouldSkipThinLibraryRecoveryInflate(
  policy: ThinLibraryPolicyResult,
  currentLength: number,
): boolean {
  if (policy.action === "insufficient") return true;
  return policy.action === "honest_partial" && currentLength >= policy.targetLength;
}

export function applyThinLibraryDeliveryCap<T>(
  tracks: T[],
  policy: ThinLibraryPolicyResult,
): { tracks: T[]; applied: boolean } {
  if (policy.action !== "honest_partial") {
    return { tracks, applied: false };
  }
  if (tracks.length <= policy.targetLength) {
    return { tracks, applied: false };
  }
  return { tracks: tracks.slice(0, policy.targetLength), applied: true };
}
