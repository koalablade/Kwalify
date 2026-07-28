/**
 * World proof gate — tracks 1–5 must prove the committed world before ship.
 * Track 1 sets identity; tracks 2–5 must continue it. Perfect opener + bad tail = fail.
 */

import type { CommittedWorld } from "../committed-world";
import {
  evaluateIntentFidelity,
  selectIntentFidelityHonestPartialTracks,
  WORLD_PROOF_SLOTS,
  type IntentFidelityResult,
  type IntentFidelityTrack,
} from "./intent-fidelity-gate";

export { WORLD_PROOF_SLOTS };

export type WorldProofResult = {
  passed: boolean;
  trackOnePassed: boolean;
  continuationPassed: boolean;
  failures: string[];
  fidelity: IntentFidelityResult;
  verifiedTracks: IntentFidelityTrack[];
  honestPartialCap: number;
};

export function buildWorldProofHonestPartialMessage(verifiedCount: number): string {
  return (
    `Found ${verifiedCount} track${verifiedCount === 1 ? "" : "s"} that genuinely fit this world — ` +
    "publishing only those rather than padding with mismatched filler."
  );
}

export function evaluateWorldProof(opts: {
  tracks: IntentFidelityTrack[];
  committed: CommittedWorld | null;
  prompt: string;
  requestedLength: number;
}): WorldProofResult {
  const fidelity = evaluateIntentFidelity(opts);
  const { tracks, committed } = opts;

  if (!committed?.hardLock || tracks.length === 0) {
    return {
      passed: fidelity.passed,
      trackOnePassed: fidelity.openerPassed,
      continuationPassed: true,
      failures: [...fidelity.openerFailures, ...fidelity.sampleFailures],
      fidelity,
      verifiedTracks: fidelity.salvageableTracks,
      honestPartialCap: fidelity.honestPartialCap,
    };
  }

  const proofFailures = [...fidelity.openerFailures];
  const trackOne = tracks[0];
  const trackOneLabel = trackOne
    ? `${trackOne.artistName?.trim() || "?"} — ${trackOne.trackName?.trim() || "?"}`
    : "";
  const trackOneFailed = proofFailures.includes(trackOneLabel);
  const trackOnePassed = trackOne != null && !trackOneFailed;
  const continuationPassed =
    proofFailures.filter((f) => f !== trackOneLabel).length === 0;

  const allVerified = fidelity.worldVerifiedCount === tracks.length && tracks.length > 0;
  const passed =
    trackOnePassed &&
    continuationPassed &&
    fidelity.openerPassed &&
    allVerified &&
    fidelity.passed;

  return {
    passed,
    trackOnePassed,
    continuationPassed,
    failures: proofFailures,
    fidelity,
    verifiedTracks: fidelity.salvageableTracks,
    honestPartialCap: fidelity.honestPartialCap,
  };
}

/** Strip every off-world track — honest partial beats padded broken playlist. */
export function filterTracksByWorldIdentity<T extends IntentFidelityTrack & { trackId?: string }>(
  tracks: T[],
  result: IntentFidelityResult,
  committed: CommittedWorld | null,
): T[] {
  if (!committed?.hardLock) return tracks;
  return selectIntentFidelityHonestPartialTracks(tracks, result, committed);
}
