/**
 * World proof gate — full-playlist cultural identity validation before ship.
 * V11: sample tracks 1,2,3,5,10,15 — 80%+ pass on hard lock, 70%+ on medium.
 */

import type { CommittedWorld } from "../committed-world";
import type { CoverageLevel } from "./world-coverage";
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

/** V12 scene-tail sample indices (0-based): tracks 1,3,5,10 */
export const V12_SCENE_TAIL_SAMPLE_INDICES = [0, 2, 4, 9] as const;

export { WORLD_PROOF_SLOTS, WORLD_BODY_PROOF_SLOTS };

/** V11 full-playlist sample indices (0-based): tracks 1,2,3,5,10,15 */
export const V11_FULL_PLAYLIST_SAMPLE_INDICES = [0, 1, 2, 4, 9, 14] as const;

const OPENER_AVG_IDENTITY_THRESHOLD = 0.65;
const BODY_MAX_OFF_WORLD = 1;
const HARD_LOCK_SAMPLE_PASS_RATE = 0.8;
const MEDIUM_LOCK_SAMPLE_PASS_RATE = 0.7;
const SAMPLE_MIN_WORLD_SCORE = 0.5;

export type WorldProofResult = {
  passed: boolean;
  trackOnePassed: boolean;
  continuationPassed: boolean;
  bodyPassed: boolean;
  fullPlaylistPassed: boolean;
  samplePassRate: number;
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

function samplePassRateForTracks(
  tracks: IntentFidelityTrack[],
  profile: NonNullable<ReturnType<typeof resolveCulturalProfileForCommitted>>,
  indices: readonly number[],
): { passRate: number; failures: string[] } {
  const failures: string[] = [];
  const sampleIndices = indices.filter((i) => i < tracks.length);
  if (sampleIndices.length === 0) return { passRate: 1, failures };
  let passed = 0;
  for (const idx of sampleIndices) {
    const track = tracks[idx]!;
    const score = scoreTrackWorldIdentity(track, profile);
    if (score >= SAMPLE_MIN_WORLD_SCORE) {
      passed += 1;
    } else {
      failures.push(`sample_off_world:${trackLabel(track)}:${score.toFixed(2)}`);
    }
  }
  return { passRate: passed / sampleIndices.length, failures };
}

function requiredSamplePassRate(coverageLevel: CoverageLevel | null | undefined): number {
  if (coverageLevel === "MEDIUM") return MEDIUM_LOCK_SAMPLE_PASS_RATE;
  return HARD_LOCK_SAMPLE_PASS_RATE;
}

function culturalIdentityFailures(
  tracks: IntentFidelityTrack[],
  committed: CommittedWorld,
  coverageLevel?: CoverageLevel | null,
): {
  openerAvg: number;
  bodyOffWorld: number;
  lastGoodIndex: number;
  samplePassRate: number;
  fullPlaylistPassed: boolean;
  failures: string[];
} {
  const profile = resolveCulturalProfileForCommitted(committed);
  const failures: string[] = [];
  if (!profile) {
    return {
      openerAvg: 1,
      bodyOffWorld: 0,
      lastGoodIndex: tracks.length - 1,
      samplePassRate: 1,
      fullPlaylistPassed: true,
      failures,
    };
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
    } else if (score < SAMPLE_MIN_WORLD_SCORE && lastGoodIndex >= i) {
      lastGoodIndex = i - 1;
    }
  }

  if (bodyOffWorld > BODY_MAX_OFF_WORLD) {
    failures.push(`body_off_world_excess:${bodyOffWorld}`);
  }

  const sampleIndices = [
    ...new Set([...V11_FULL_PLAYLIST_SAMPLE_INDICES, ...V12_SCENE_TAIL_SAMPLE_INDICES]),
  ] as readonly number[];
  const sample = samplePassRateForTracks(tracks, profile, sampleIndices);
  const requiredRate = requiredSamplePassRate(coverageLevel);
  const fullPlaylistPassed = sample.passRate >= requiredRate;
  if (!fullPlaylistPassed) {
    failures.push(`full_playlist_sample_fail:${sample.passRate.toFixed(2)}`);
    failures.push(...sample.failures);
  }

  return {
    openerAvg,
    bodyOffWorld,
    lastGoodIndex,
    samplePassRate: sample.passRate,
    fullPlaylistPassed,
    failures,
  };
}

export function evaluateWorldProof(opts: {
  tracks: IntentFidelityTrack[];
  committed: CommittedWorld | null;
  prompt: string;
  requestedLength: number;
  coverageLevel?: CoverageLevel | null;
}): WorldProofResult {
  const fidelity = evaluateIntentFidelity(opts);
  const { tracks, committed } = opts;

  if (!committed?.hardLock || tracks.length === 0) {
    return {
      passed: fidelity.passed,
      trackOnePassed: fidelity.openerPassed,
      continuationPassed: true,
      bodyPassed: fidelity.bodyFailures.length === 0,
      fullPlaylistPassed: true,
      samplePassRate: 1,
      openerAvgIdentityScore: 1,
      bodyOffWorldCount: 0,
      lastGoodIndex: tracks.length - 1,
      failures: [...fidelity.openerFailures, ...fidelity.bodyFailures, ...fidelity.sampleFailures],
      fidelity,
      verifiedTracks: fidelity.salvageableTracks,
      honestPartialCap: fidelity.honestPartialCap,
    };
  }

  const cultural = culturalIdentityFailures(tracks, committed, opts.coverageLevel);
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
    cultural.fullPlaylistPassed &&
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
    fullPlaylistPassed: cultural.fullPlaylistPassed,
    samplePassRate: cultural.samplePassRate,
    openerAvgIdentityScore: cultural.openerAvg,
    bodyOffWorldCount: cultural.bodyOffWorld,
    lastGoodIndex,
    failures: proofFailures,
    fidelity,
    verifiedTracks,
    honestPartialCap: fidelity.honestPartialCap,
  };
}

/** Strip off-world tracks — honest partial beats padded broken playlist. No generic backfill. */
export function filterTracksByWorldIdentity<T extends IntentFidelityTrack & { trackId?: string }>(
  tracks: T[],
  result: IntentFidelityResult,
  committed: CommittedWorld | null,
): T[] {
  if (!committed?.hardLock) return tracks;
  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) {
    return selectIntentFidelityHonestPartialTracks(tracks, result, committed);
  }
  const kept: T[] = [];
  for (const track of tracks) {
    const score = scoreTrackWorldIdentity(track, profile);
    if (score >= SAMPLE_MIN_WORLD_SCORE) kept.push(track);
  }
  if (kept.length >= 3) {
    return kept.slice(0, result.honestPartialCap);
  }
  return selectIntentFidelityHonestPartialTracks(tracks, result, committed);
}

/** V12 tail strip — remove off-world tracks 5–10 without backfill. */
export function stripTailWorldViolations<T extends IntentFidelityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
): { tracks: T[]; removed: number } {
  if (!committed?.hardLock || tracks.length <= 5) return { tracks, removed: 0 };
  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) return { tracks, removed: 0 };

  const head = tracks.slice(0, 4);
  const tail = tracks.slice(4, 10);
  const rest = tracks.slice(10);
  const keptTail: T[] = [];
  let removed = 0;
  for (const track of tail) {
    const score = scoreTrackWorldIdentity(track, profile);
    if (score >= SAMPLE_MIN_WORLD_SCORE) keptTail.push(track);
    else removed += 1;
  }
  if (removed === 0) return { tracks, removed: 0 };
  return { tracks: [...head, ...keptTail, ...rest], removed };
}

/** V11 final pass — remove off-world tracks without generic backfill. */
export function filterTracksByFullWorldProof<T extends IntentFidelityTrack & { trackId?: string }>(
  tracks: T[],
  committed: CommittedWorld | null,
  coverageLevel?: CoverageLevel | null,
): { tracks: T[]; removed: number } {
  if (!committed?.hardLock) return { tracks, removed: 0 };
  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) return { tracks, removed: 0 };

  const kept: T[] = [];
  let removed = 0;
  for (const track of tracks) {
    const score = scoreTrackWorldIdentity(track, profile);
    if (score < SAMPLE_MIN_WORLD_SCORE) {
      removed += 1;
      continue;
    }
    kept.push(track);
  }
  if (kept.length >= 3) {
    return { tracks: kept, removed };
  }
  return { tracks, removed: 0 };
}
