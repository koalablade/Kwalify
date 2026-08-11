/**
 * V15 world purity gate — full-playlist immersion after thesis opener.
 * Position-tiered thresholds, shorten-not-corrupt first five, honest partial with coverage caps.
 */

import type { CommittedWorld } from "../committed-world";
import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { matchesAvoidArtist, rosterTierScoreFloor } from "./cultural-identity-profile";
import type { CoverageLevel, CoverageTier } from "./world-coverage";
import {
  buildDeliveryMessage,
  coverageLevelToMaxTracks,
  coverageUserMessage,
  getDeliveryCap,
  coverageLevelToDeliveryTier,
} from "./world-coverage";
import { recordRetrievalRejection } from "./retrieval-rejection-trace";
import {
  resolveCulturalProfileForCommitted,
  scoreTrackWorldIdentity,
  isAnchorArtistForProfile,
  type WorldIdentityTrack,
} from "./world-identity-score";
import { sequenceAfterPurityFilter } from "./world-sequencer";
import { selectThesisOpener } from "./thesis-opener-gate";

/** Checkpoint indices (0-based): tracks 1, 2, 5, 10, 15 */
export const WORLD_PURITY_CHECKPOINT_INDICES = [0, 1, 4, 9, 14] as const;

/** Audit-only sub-stage counts observed inside applyWorldPurityGate (no extra purity pass). */
export type PurityCheckpointDecision = {
  checkpointSurvivorIndex: number;
  compositionPosition: number;
  artist: string;
  track: string;
  score: number;
  threshold: number;
  passed: boolean;
};

export type PuritySubFunnelDiagnostics = {
  prePurityCount: number;
  postFilterByWorldPurityCount: number;
  postCheckpointStripCount: number;
  checkpointStripApplied: boolean;
  removedReasons: string[];
  checkpointDecisions: PurityCheckpointDecision[];
  checkpointRemovedReasons: string[];
};

export type WorldPurityResult = {
  tracks: WorldIdentityTrack[];
  removed: number;
  removedReasons: string[];
  checkpointFailures: string[];
  wouldStillBelieve: boolean;
  honestPartial: boolean;
  coverageMessage: string | null;
  deliveryMessage: string | null;
  salvageableCount: number;
  /** Populated on every applyWorldPurityGate call — diagnostic only. */
  subFunnel: PuritySubFunnelDiagnostics;
};

function identitySubFunnel(tracks: WorldIdentityTrack[], removedReasons: string[] = []): PuritySubFunnelDiagnostics {
  const count = tracks.length;
  return {
    prePurityCount: count,
    postFilterByWorldPurityCount: count,
    postCheckpointStripCount: count,
    checkpointStripApplied: false,
    removedReasons,
    checkpointDecisions: [],
    checkpointRemovedReasons: [],
  };
}

/** V15 position-tier purity threshold (0–100): T1 95+, T2-3 90+, T4-5 85+, T6-10 85+, T11+ 80+. */
export function worldPurityThresholdForPosition(position: number): number {
  if (position === 0) return 95;
  if (position <= 2) return 90;
  if (position <= 4) return 85;
  if (position <= 9) return 85;
  return 80;
}

/** Position tier with roster floor — roster-qualified artists pass at their roster score, not arbitrary metadata tiers. */
export function effectivePurityThresholdForTrack(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  compositionPosition: number,
  opts?: { isThesisOpener?: boolean },
): number {
  const artist = String(track.artistName ?? "").trim();
  const isAnchor = artist ? isAnchorArtistForProfile(artist, profile) : false;

  if (compositionPosition === 0 && (opts?.isThesisOpener || isAnchor)) {
    return Math.round((profile.openerRules.minWorldIdentityScore ?? 0.8) * 100);
  }

  const positionThreshold = worldPurityThresholdForPosition(compositionPosition);
  if (!artist) return positionThreshold;

  const rosterFloor = rosterTierScoreFloor(artist, profile);
  if (rosterFloor == null) return positionThreshold;

  return Math.min(positionThreshold, Math.round(rosterFloor * 100));
}

/** World identity score scaled 0–100. */
export function scoreTrackPurityPercent(track: WorldIdentityTrack, profile: CulturalWorldProfile): number {
  return Math.round(scoreTrackWorldIdentity(track, profile) * 100);
}

export function trackPassesWorldPurity(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  position: number,
  opts?: { isThesisOpener?: boolean },
): boolean {
  const artist = String(track.artistName ?? "").trim();
  if (artist && matchesAvoidArtist(artist, profile)) return false;

  const score = scoreTrackPurityPercent(track, profile);
  const threshold = effectivePurityThresholdForTrack(track, profile, position, opts);
  return score >= threshold;
}

/** Human listener simulation — curator belief at checkpoints. */
export function evaluateCheckpointDecisions(
  tracks: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  compositionPositions?: readonly number[],
): PurityCheckpointDecision[] {
  const decisions: PurityCheckpointDecision[] = [];
  for (const idx of WORLD_PURITY_CHECKPOINT_INDICES) {
    if (idx >= tracks.length) continue;
    const track = tracks[idx]!;
    const compositionPosition = compositionPositions?.[idx] ?? idx;
    const score = scoreTrackPurityPercent(track, profile);
    const isThesis = compositionPosition === 0;
    const isAnchor = isAnchorArtistForProfile(track.artistName, profile);
    const threshold = effectivePurityThresholdForTrack(track, profile, compositionPosition, {
      isThesisOpener: isThesis && isAnchor,
    });
    const passed = !(
      String(track.artistName ?? "").trim() &&
      matchesAvoidArtist(String(track.artistName ?? ""), profile)
    ) && score >= threshold;
    decisions.push({
      checkpointSurvivorIndex: idx,
      compositionPosition,
      artist: String(track.artistName ?? "?"),
      track: String(track.trackName ?? "?"),
      score,
      threshold,
      passed,
    });
  }
  return decisions;
}

export function wouldStillBelieveSameCurator(
  prompt: string,
  tracks: WorldIdentityTrack[],
  committed: CommittedWorld | null,
  profile: CulturalWorldProfile | null,
  compositionPositions?: readonly number[],
): { believe: boolean; failures: string[] } {
  void prompt;
  if (!committed?.hardLock || !profile || tracks.length === 0) {
    return { believe: true, failures: [] };
  }
  const decisions = evaluateCheckpointDecisions(tracks, profile, compositionPositions);
  const failures = decisions
    .filter((d) => !d.passed)
    .map(
      (d) =>
        `checkpoint_${d.checkpointSurvivorIndex + 1}:${d.artist} — ${d.track}:${d.score}<${d.threshold}@pos_${d.compositionPosition + 1}`,
    );
  return { believe: failures.length === 0, failures };
}

/** Remove tracks failing position-tier purity — no backfill, shorten-not-corrupt. */
export function filterByWorldPurity<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
): {
  tracks: T[];
  removed: number;
  removedReasons: string[];
  survivorCompositionPositions: number[];
} {
  if (!committed?.hardLock || tracks.length === 0) {
    return { tracks, removed: 0, removedReasons: [], survivorCompositionPositions: [] };
  }
  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) {
    return { tracks, removed: 0, removedReasons: [], survivorCompositionPositions: [] };
  }

  const thesis = selectThesisOpener(tracks, profile);
  const thesisKey = thesis ? `${thesis.track.artistName}|${thesis.track.trackName}` : null;

  const kept: T[] = [];
  const survivorCompositionPositions: number[] = [];
  const removedReasons: string[] = [];
  let removed = 0;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    const trackKey = `${track.artistName}|${track.trackName}`;
    const isThesisOpener = i === 0 || (thesisKey != null && trackKey === thesisKey);
    if (trackPassesWorldPurity(track, profile, i, { isThesisOpener })) {
      kept.push(track);
      survivorCompositionPositions.push(i);
    } else {
      removed += 1;
      const score = scoreTrackPurityPercent(track, profile);
      const threshold = effectivePurityThresholdForTrack(track, profile, i, { isThesisOpener });
      const worldId = committed.worldIds?.[0] ?? committed.id;
      recordRetrievalRejection({
        worldId,
        artistName: track.artistName ?? "",
        trackName: track.trackName ?? "",
        reason: `purity_pos_${i + 1}:${score}<${threshold}`,
        stage: "purity_gate",
        worldIdentityScore: score / 100,
      });
      removedReasons.push(
        `pos_${i + 1}:${track.artistName ?? "?"} — ${track.trackName ?? "?"}:${score}<${threshold}`,
      );
    }
  }

  if (kept.length > 0 || removed === 0) {
    return { tracks: kept, removed, removedReasons, survivorCompositionPositions };
  }
  return { tracks, removed: 0, removedReasons: [], survivorCompositionPositions: [] };
}

/** Strip from first failing checkpoint forward when belief breaks. */
export function stripFromCheckpointFailure<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  profile: CulturalWorldProfile | null,
  compositionPositions?: readonly number[],
): {
  tracks: T[];
  stripped: number;
  failures: string[];
  checkpointDecisions: PurityCheckpointDecision[];
  checkpointRemovedReasons: string[];
} {
  if (!committed?.hardLock || !profile || tracks.length === 0) {
    return {
      tracks,
      stripped: 0,
      failures: [],
      checkpointDecisions: [],
      checkpointRemovedReasons: [],
    };
  }
  const checkpointDecisions = evaluateCheckpointDecisions(tracks, profile, compositionPositions);
  const belief = wouldStillBelieveSameCurator("", tracks, committed, profile, compositionPositions);
  if (belief.believe) {
    return {
      tracks,
      stripped: 0,
      failures: [],
      checkpointDecisions,
      checkpointRemovedReasons: [],
    };
  }

  let cutIndex = tracks.length;
  for (const decision of checkpointDecisions) {
    if (!decision.passed) {
      cutIndex = Math.min(cutIndex, decision.checkpointSurvivorIndex);
      break;
    }
  }
  const checkpointRemovedReasons = checkpointDecisions
    .filter((d) => !d.passed)
    .map(
      (d) =>
        `checkpoint_${d.checkpointSurvivorIndex + 1}:${d.artist} — ${d.track}:${d.score}<${d.threshold}@pos_${d.compositionPosition + 1}`,
    );

  if (cutIndex >= tracks.length) {
    return { tracks, stripped: 0, failures: belief.failures, checkpointDecisions, checkpointRemovedReasons };
  }
  const kept = tracks.slice(0, cutIndex);
  if (kept.length >= 3) {
    return {
      tracks: kept,
      stripped: tracks.length - kept.length,
      failures: belief.failures,
      checkpointDecisions,
      checkpointRemovedReasons,
    };
  }
  if (kept.length > 0) {
    return {
      tracks: kept,
      stripped: tracks.length - kept.length,
      failures: belief.failures,
      checkpointDecisions,
      checkpointRemovedReasons,
    };
  }
  return { tracks, stripped: 0, failures: belief.failures, checkpointDecisions, checkpointRemovedReasons };
}

/** V15 final pass — purity filter, checkpoint strip, sequence, honest partial cap. */
export function applyWorldPurityGate<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  opts?: {
    prompt?: string;
    requestedLength?: number;
    coverageLevel?: CoverageLevel | null;
    coverageTier?: CoverageTier | null;
    preserveOpener?: boolean;
  },
): WorldPurityResult & { tracks: T[] } {
  const requested = Math.max(1, opts?.requestedLength ?? 25);
  const coverageLevel = opts?.coverageLevel ?? null;
  const coverageTier =
    opts?.coverageTier ?? (coverageLevel != null ? coverageLevelToDeliveryTier(coverageLevel) : null);

  const prePurityCount = tracks.length;

  if (!committed?.hardLock || tracks.length === 0) {
    return {
      tracks,
      removed: 0,
      removedReasons: [],
      checkpointFailures: [],
      wouldStillBelieve: true,
      honestPartial: false,
      coverageMessage: null,
      deliveryMessage: null,
      salvageableCount: tracks.length,
      subFunnel: identitySubFunnel(tracks),
    };
  }

  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) {
    return {
      tracks,
      removed: 0,
      removedReasons: [],
      checkpointFailures: [],
      wouldStillBelieve: true,
      honestPartial: false,
      coverageMessage: null,
      deliveryMessage: null,
      salvageableCount: tracks.length,
      subFunnel: identitySubFunnel(tracks),
    };
  }

  const opener = opts?.preserveOpener && tracks.length > 0 ? tracks[0] : null;
  let working = [...tracks];
  const filtered = filterByWorldPurity(working, committed);
  if (filtered.removed > 0 && filtered.tracks.length > 0) {
    working = filtered.tracks;
  } else if (filtered.removed > 0 && filtered.tracks.length === 0 && tracks.length > 0) {
    const thesis = selectThesisOpener(tracks, profile);
    if (thesis) {
      const rest = tracks.filter(
        (t) =>
          `${t.artistName}|${t.trackName}` !== `${thesis.track.artistName}|${thesis.track.trackName}`,
      );
      const salvage = [thesis.track, ...rest].filter((t, i) =>
        trackPassesWorldPurity(t, profile, i, { isThesisOpener: i === 0 }),
      );
      if (salvage.length > 0) working = salvage as T[];
    }
  }

  const postFilterByWorldPurityCount = working.length;

  const stripped = stripFromCheckpointFailure(
    working,
    committed,
    profile,
    filtered.survivorCompositionPositions,
  );
  const checkpointStripApplied = stripped.stripped > 0 && stripped.tracks.length > 0;
  if (checkpointStripApplied) {
    working = stripped.tracks;
  }
  const postCheckpointStripCount = working.length;

  const belief = wouldStillBelieveSameCurator(
    opts?.prompt ?? "",
    working,
    committed,
    profile,
    filtered.survivorCompositionPositions.slice(0, working.length),
  );

  if (opener && working.length > 0 && working[0] !== opener) {
    const rest = working.filter((t) => t !== opener);
    working = [opener, ...rest] as T[];
  }

  const sequenced = sequenceAfterPurityFilter(working, committed, profile) as T[];
  working = sequenced;

  const coverageCap =
    coverageTier != null
      ? getDeliveryCap(coverageTier, requested)
      : coverageLevel != null
        ? coverageLevelToMaxTracks(coverageLevel, requested)
        : requested;
  const honestPartial = working.length < requested;
  let salvageableCount = working.length;
  if (working.length > coverageCap && coverageCap > 0) {
    salvageableCount = coverageCap;
    working = working.slice(0, coverageCap);
  }

  const deliveryMessage =
    honestPartial && working.length > 0
      ? buildDeliveryMessage(working.length, coverageTier)
      : null;
  const coverageMessage =
    deliveryMessage ??
    (honestPartial && coverageLevel
      ? coverageUserMessage(coverageLevel)
      : honestPartial
        ? `Found ${working.length} track${working.length === 1 ? "" : "s"} that genuinely fit this world — publishing only those rather than padding with mismatched filler.`
        : null);

  return {
    tracks: working,
    removed: filtered.removed + stripped.stripped,
    removedReasons: [...filtered.removedReasons],
    checkpointFailures: belief.failures,
    wouldStillBelieve: belief.believe,
    honestPartial,
    coverageMessage,
    deliveryMessage,
    salvageableCount: Math.max(salvageableCount, working.length > 0 ? working.length : 0),
    subFunnel: {
      prePurityCount,
      postFilterByWorldPurityCount,
      postCheckpointStripCount,
      checkpointStripApplied,
      removedReasons: [...filtered.removedReasons],
      checkpointDecisions: stripped.checkpointDecisions,
      checkpointRemovedReasons: stripped.checkpointRemovedReasons,
    },
  };
}
