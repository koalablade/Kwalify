/**
 * Tier-aware Shareability verdict — Experiment E.
 * Evaluates recommend-to-a-friend worthiness without changing HCS dimensions.
 */

import type { ListenabilityFailure } from "./human-curation-sequencer";
import {
  classifySaveabilityDeliveryTier,
  type SaveabilityDeliveryTier,
  type HumanCurationVerdict,
} from "./saveability-verdict";

export const SHARE_YES_HCS_MIN = 85;
export const SHARE_MAYBE_HCS_MIN = 70;

/** MINI deliveries need Save-parity excellence before recommending to others. */
export const SHARE_MINI_YES_HCS_MIN = 88;
export const SHARE_MINI_YES_MOMENT_MIN = 22;

/** Core dimension floors for recommending a playlist outward. */
export const SHARE_CORE_MOMENT_MIN = 20;
export const SHARE_CORE_COHESION_MIN = 18;
export const SHARE_CORE_PLAUSIBILITY_MIN = 11;

/** Sequencing below this indicates multiple major flow failures (e.g. madchester 9/20). */
export const SHARE_MAJOR_SEQUENCING_FLOOR = 10;

const MAJOR_SEQUENCING_SHARE_CODES = new Set([
  "obscure_opener",
  "artist_run_3",
  "madchester_oasis_cluster",
]);

export function hasMajorSequencingShareBlocker(
  sequencingScore: number,
  listenabilityFailures: ListenabilityFailure[] = [],
): boolean {
  if (sequencingScore < SHARE_MAJOR_SEQUENCING_FLOOR) return true;
  return listenabilityFailures.some(
    (f) => f.severity === "major" && MAJOR_SEQUENCING_SHARE_CODES.has(f.code),
  );
}

export type ShareabilityVerdictInput = {
  totalScore: number;
  trackCount: number;
  sequencingScore: number;
  momentScore: number;
  cohesionScore: number;
  plausibilityScore: number;
  listenabilityFailures?: ListenabilityFailure[];
  deliveryTier?: SaveabilityDeliveryTier;
};

/** Pre-E flat gate preserved for before/after diagnostics. */
export function legacyFlatSequencingWouldShare(totalScore: number, sequencingScore: number): HumanCurationVerdict {
  return totalScore >= SHARE_YES_HCS_MIN && sequencingScore >= 14
    ? "YES"
    : totalScore >= SHARE_MAYBE_HCS_MIN
      ? "MAYBE"
      : "NO";
}

/**
 * Share verdict: strong overall curation + no major sequencing failures + tier context.
 * Does not use a single sequencing cliff (e.g. 13 vs 14).
 */
export function deriveWouldShareVerdict(input: ShareabilityVerdictInput): HumanCurationVerdict {
  const failures = input.listenabilityFailures ?? [];
  const tier = input.deliveryTier ?? classifySaveabilityDeliveryTier(input.trackCount, failures);
  const { totalScore, sequencingScore, momentScore, cohesionScore, plausibilityScore } = input;

  if (totalScore < SHARE_MAYBE_HCS_MIN) return "NO";

  if (tier === "STUB") {
    return "MAYBE";
  }

  if (hasMajorSequencingShareBlocker(sequencingScore, failures)) {
    return "MAYBE";
  }

  const coreStrong =
    momentScore >= SHARE_CORE_MOMENT_MIN &&
    cohesionScore >= SHARE_CORE_COHESION_MIN &&
    plausibilityScore >= SHARE_CORE_PLAUSIBILITY_MIN;

  if (totalScore >= SHARE_YES_HCS_MIN && coreStrong) {
    if (tier === "FULL" || tier === "PARTIAL") {
      return "YES";
    }
    if (
      tier === "MINI" &&
      totalScore >= SHARE_MINI_YES_HCS_MIN &&
      momentScore >= SHARE_MINI_YES_MOMENT_MIN
    ) {
      return "YES";
    }
  }

  return "MAYBE";
}
