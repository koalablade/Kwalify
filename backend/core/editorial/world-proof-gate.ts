/**
 * World proof gate — tracks 1–5 must prove the committed world before ship.
 * Track 1 sets identity; tracks 2–5 must continue it. Perfect opener + bad tail = fail.
 */

import type { CommittedWorld } from "../committed-world";
import {
  evaluateIntentFidelity,
  selectIntentFidelityHonestPartialTracks,
  WORLD_PROOF_SLOTS,
  WORLD_BODY_PROOF_SLOTS,
  type IntentFidelityResult,
  type IntentFidelityTrack,
} from "./intent-fidelity-gate";
import {
  resolveCulturalProfileForCommitted,
  scoreTrackWorldIdentity,
} from "./world-identity-score";
import { THESIS_OPENER_MIN_SCORE } from "./thesis-opener-gate";

export { WORLD_PROOF_SLOTS, WORLD_BODY_PROOF_SLOTS };

const OPENER_AVG_IDENTITY_THRESHOLD = 0.65;
const BODY_MAX_OFF_WORLD = 1;

export type WorldProofResult = {
  passed: boolean;
  trackOnePassed: boolean;
  continuationPassed: boolean;
  bodyPassed: boolean;
  openerAvgIdentityScore: number;
  bodyOffWorldCount: number;
  lastGoodIndex: number;
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

function trackLabel(track: IntentFidelityTrack): string {
  return `${track.artistName?.trim() || "?"} — ${track.trackName?.trim() || "?"}`;
}

function culturalIdentityFailures(
  tracks: IntentFidelityTrack[],
  committed: CommittedWorld,
): {
  openerAvg: number;
  bodyOffWorld: number;
  lastGoodIndex: number;
  failures: string[];
} {
  const profile = resolveCulturalProfileForCommitted(committed);
  const failures: string[] = [];
  if (!profile) {
    return { openerAvg: 1, bodyOffWorld: 0, lastGoodIndex: tracks.length - 1, failures };
  }

  const openerSlots = Math.min(WORLD_PROOF_SLOTS, tracks.length);
  let openerSum = 0;
  for (let i = 0; i < openerSlots; i++) {
    const track = tracks[i]!;
    const score = scoreTrackWorldIdentity(track, profile);
    openerSum += score;
    if (score === 0) failures.push(`forbidden_opener:${trackLabel(track)}`);
    if (i === 0 && score < (profile.openerRules.minWorldIdentityScore ?? THESIS_OPENER_MIN_SCORE)) {
      failures.push(`thesis_opener_weak:${trackLabel(track)}`);
    }
  }
  const openerAvg = openerSlots > 0 ? openerSum / openerSlots : 1;
  if (openerAvg < OPENER_AVG_IDENTITY_THRESHOLD) {
    failures.push(`opener_avg_identity_low:${openerAvg.toFixed(2)}`);
  }

  const bodyStart = WORLD_PROOF_SLOTS;
  const bodyEnd = Math.min(WORLD_PROOF_SLOTS + WORLD_BODY_PROOF_SLOTS, tracks.length);
  let bodyOffWorld = 0;
  let lastGoodIndex = tracks.length - 1;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    const score = scoreTrackWorldIdentity(track, profile);
    if (score === 0) {
      if (i >= bodyStart && i < bodyEnd) bodyOffWorld += 1;
      failures.push(`forbidden_body:${trackLabel(track)}`);
      if (lastGoodIndex >= i) lastGoodIndex = i - 1;
    } else if (i >= bodyStart && i < bodyEnd && score < 0.45) {
      bodyOffWorld += 1;
      failures.push(`body_drift:${trackLabel(track)}`);
    }
  }

  if (bodyOffWorld > BODY_MAX_OFF_WORLD) {
    failures.push(`body_off_world_excess:${bodyOffWorld}`);
  }

  return { openerAvg, bodyOffWorld, lastGoodIndex, failures };
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
      bodyPassed: fidelity.bodyFailures.length === 0,
      openerAvgIdentityScore: 1,
      bodyOffWorldCount: 0,
      lastGoodIndex: tracks.length - 1,
      failures: [...fidelity.openerFailures, ...fidelity.bodyFailures, ...fidelity.sampleFailures],
      fidelity,
      verifiedTracks: fidelity.salvageableTracks,
      honestPartialCap: fidelity.honestPartialCap,
    };
  }

  const cultural = culturalIdentityFailures(tracks, committed);
  const proofFailures = [
    ...new Set([...fidelity.openerFailures, ...fidelity.bodyFailures, ...cultural.failures]),
  ];
  const trackOne = tracks[0];
  const trackOneLabel = trackOne ? trackLabel(trackOne) : "";
  const trackOneFailed = proofFailures.some(
    (f) => f === trackOneLabel || f.endsWith(trackOneLabel) || f.includes("thesis_opener"),
  );
  const trackOnePassed = trackOne != null && !trackOneFailed && fidelity.openerPassed;
  const continuationPassed =
    proofFailures.filter((f) => f !== trackOneLabel && !f.startsWith("thesis_opener")).length === 0;
  const bodyPassed =
    fidelity.bodyFailures.length === 0 && cultural.bodyOffWorld <= BODY_MAX_OFF_WORLD;

  const allVerified = fidelity.worldVerifiedCount === tracks.length && tracks.length > 0;
  const passed =
    trackOnePassed &&
    continuationPassed &&
    bodyPassed &&
    fidelity.openerPassed &&
    cultural.openerAvg >= OPENER_AVG_IDENTITY_THRESHOLD &&
    allVerified &&
    fidelity.passed;

  const lastGoodIndex = Math.max(0, cultural.lastGoodIndex);
  const verifiedTracks =
    !passed && lastGoodIndex >= 2
      ? tracks.slice(0, lastGoodIndex + 1)
      : fidelity.salvageableTracks;

  return {
    passed,
    trackOnePassed,
    continuationPassed,
    bodyPassed,
    openerAvgIdentityScore: cultural.openerAvg,
    bodyOffWorldCount: cultural.bodyOffWorld,
    lastGoodIndex,
    failures: proofFailures,
    fidelity,
    verifiedTracks,
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
