/**
 * Tier-aware Saveability verdict — Experiment D.
 * Reuses V15 delivery-tier semantics (world-coverage + MIN_SALVAGEABLE)
 * without changing HCS dimension scoring.
 */

import type { ListenabilityFailure } from "./human-curation-sequencer";

export type HumanCurationVerdict = "YES" | "MAYBE" | "NO";

/** Product-facing delivery tier for Save eligibility. */
export type SaveabilityDeliveryTier = "FULL" | "PARTIAL" | "MINI" | "STUB";

/** Legacy flat gate: totalScore >= 80 && tracks >= 8. */
export const SAVEABILITY_FULL_MIN_TRACKS = 8;

/** Aligns with getDeliveryTarget("LOW").min in world-coverage.ts. */
export const SAVEABILITY_PARTIAL_MIN_TRACKS = 6;

/** Aligns with MIN_SALVAGEABLE / getDeliveryTarget("VERY_LOW").min. */
export const SAVEABILITY_MINI_MIN_TRACKS = 3;

export const SAVEABILITY_YES_HCS_MIN = 80;
export const SAVEABILITY_MAYBE_HCS_MIN = 60;

/** Deliberately short honest deliveries need a higher quality bar than partial/full. */
export const SAVEABILITY_MINI_YES_HCS_MIN = 88;

/** Blocks MINI YES when moment dimension carries thin-delivery penalties. */
export const SAVEABILITY_MINI_YES_MOMENT_MIN = 22;

const STUB_FAILURE_CODES = new Set(["stub_playlist", "disco_thin_delivery", "empty_delivery"]);

export function hasMajorStubListenabilityFailure(failures: ListenabilityFailure[]): boolean {
  return failures.some((f) => f.severity === "major" && STUB_FAILURE_CODES.has(f.code));
}

/**
 * Classify delivered playlist length using existing delivery-policy breakpoints.
 * Does not use prompt names or benchmark IDs.
 */
export function classifySaveabilityDeliveryTier(
  trackCount: number,
  listenabilityFailures: ListenabilityFailure[] = [],
): SaveabilityDeliveryTier {
  if (trackCount < SAVEABILITY_MINI_MIN_TRACKS || hasMajorStubListenabilityFailure(listenabilityFailures)) {
    return "STUB";
  }
  if (trackCount >= SAVEABILITY_FULL_MIN_TRACKS) return "FULL";
  if (trackCount >= SAVEABILITY_PARTIAL_MIN_TRACKS) return "PARTIAL";
  return "MINI";
}

export type SaveabilityVerdictInput = {
  totalScore: number;
  trackCount: number;
  momentScore: number;
  listenabilityFailures?: ListenabilityFailure[];
};

/** Pre-D flat length gate preserved for before/after diagnostics. */
export function legacyFlatLengthWouldSave(totalScore: number, trackCount: number): HumanCurationVerdict {
  return totalScore >= SAVEABILITY_YES_HCS_MIN && trackCount >= SAVEABILITY_FULL_MIN_TRACKS
    ? "YES"
    : totalScore >= SAVEABILITY_MAYBE_HCS_MIN
      ? "MAYBE"
      : "NO";
}

/**
 * Tier-aware Save verdict: quality + delivery completeness + minimum usable size.
 * HCS totalScore is an input — this does not recompute dimension weights.
 */
export function deriveWouldSaveVerdict(input: SaveabilityVerdictInput): HumanCurationVerdict {
  const failures = input.listenabilityFailures ?? [];
  const tier = classifySaveabilityDeliveryTier(input.trackCount, failures);
  const { totalScore, momentScore } = input;

  if (totalScore < SAVEABILITY_MAYBE_HCS_MIN) return "NO";

  if (tier === "STUB") {
    return "MAYBE";
  }

  if (tier === "FULL" || tier === "PARTIAL") {
    return totalScore >= SAVEABILITY_YES_HCS_MIN ? "YES" : "MAYBE";
  }

  // MINI — honest VERY_LOW-tier delivery; higher bar than partial/full.
  if (totalScore >= SAVEABILITY_MINI_YES_HCS_MIN && momentScore >= SAVEABILITY_MINI_YES_MOMENT_MIN) {
    return "YES";
  }
  return "MAYBE";
}
