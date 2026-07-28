/**
 * V13 world purity gate — full-playlist immersion after thesis opener.
 * Position-tiered thresholds, no backfill, honest partial with coverage caps.
 */

import type { CommittedWorld } from "../committed-world";
import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { matchesAvoidArtist } from "./cultural-identity-profile";
import type { CoverageLevel } from "./world-coverage";
import { coverageLevelToMaxTracks, coverageUserMessage } from "./world-coverage";
import {
  resolveCulturalProfileForCommitted,
  scoreTrackWorldIdentity,
  isAnchorArtistForProfile,
  type WorldIdentityTrack,
} from "./world-identity-score";
import { sequenceAfterPurityFilter } from "./world-sequencer";

/** Checkpoint indices (0-based): tracks 1, 5, 10, 15 */
export const WORLD_PURITY_CHECKPOINT_INDICES = [0, 4, 9, 14] as const;

export type WorldPurityResult = {
  tracks: WorldIdentityTrack[];
  removed: number;
  removedReasons: string[];
  checkpointFailures: string[];
  wouldStillBelieve: boolean;
  honestPartial: boolean;
  coverageMessage: string | null;
  salvageableCount: number;
};

/** Position-tier purity threshold (0–100). */
export function worldPurityThresholdForPosition(position: number): number {
  if (position <= 4) return 90;
  if (position <= 9) return 80;
  return 70;
}

/** World identity score scaled 0–100. */
export function scoreTrackPurityPercent(track: WorldIdentityTrack, profile: CulturalWorldProfile): number {
  return Math.round(scoreTrackWorldIdentity(track, profile) * 100);
}

export function trackPassesWorldPurity(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  position: number,
): boolean {
  const artist = String(track.artistName ?? "").trim();
  if (artist && matchesAvoidArtist(artist, profile)) return false;

  const threshold = worldPurityThresholdForPosition(position);
  return scoreTrackPurityPercent(track, profile) >= threshold;
}

/** Human listener simulation — curator belief at checkpoints. */
export function wouldStillBelieveSameCurator(
  prompt: string,
  tracks: WorldIdentityTrack[],
  committed: CommittedWorld | null,
  profile: CulturalWorldProfile | null,
): { believe: boolean; failures: string[] } {
  void prompt;
  if (!committed?.hardLock || !profile || tracks.length === 0) {
    return { believe: true, failures: [] };
  }
  const failures: string[] = [];
  for (const idx of WORLD_PURITY_CHECKPOINT_INDICES) {
    if (idx >= tracks.length) continue;
    const track = tracks[idx]!;
    const score = scoreTrackPurityPercent(track, profile);
    const threshold = worldPurityThresholdForPosition(idx);
    if (score < threshold) {
      failures.push(
        `checkpoint_${idx + 1}:${track.artistName ?? "?"} — ${track.trackName ?? "?"}:${score}<${threshold}`,
      );
    }
  }
  return { believe: failures.length === 0, failures };
}

/** Remove tracks failing position-tier purity — no backfill. */
export function filterByWorldPurity<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
): { tracks: T[]; removed: number; removedReasons: string[] } {
  if (!committed?.hardLock || tracks.length === 0) {
    return { tracks, removed: 0, removedReasons: [] };
  }
  const profile = resolveCulturalProfileForCommitted(committed);
  if (!profile) return { tracks, removed: 0, removedReasons: [] };

  const kept: T[] = [];
  const removedReasons: string[] = [];
  let removed = 0;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    if (trackPassesWorldPurity(track, profile, i)) {
      kept.push(track);
    } else {
      removed += 1;
      const score = scoreTrackPurityPercent(track, profile);
      removedReasons.push(
        `pos_${i + 1}:${track.artistName ?? "?"} — ${track.trackName ?? "?"}:${score}<${worldPurityThresholdForPosition(i)}`,
      );
    }
  }

  if (kept.length >= 3 || removed === 0) {
    return { tracks: kept, removed, removedReasons };
  }
  return { tracks, removed: 0, removedReasons: [] };
}

/** Strip from first failing checkpoint forward when belief breaks. */
export function stripFromCheckpointFailure<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  profile: CulturalWorldProfile | null,
): { tracks: T[]; stripped: number; failures: string[] } {
  if (!committed?.hardLock || !profile || tracks.length === 0) {
    return { tracks, stripped: 0, failures: [] };
  }
  const belief = wouldStillBelieveSameCurator("", tracks, committed, profile);
  if (belief.believe) return { tracks, stripped: 0, failures: [] };

  let cutIndex = tracks.length;
  for (const idx of WORLD_PURITY_CHECKPOINT_INDICES) {
    if (idx >= tracks.length) continue;
    const track = tracks[idx]!;
    const score = scoreTrackPurityPercent(track, profile);
    const threshold = worldPurityThresholdForPosition(idx);
    if (score < threshold) {
      cutIndex = Math.min(cutIndex, idx);
      break;
    }
  }
  if (cutIndex >= tracks.length) return { tracks, stripped: 0, failures: belief.failures };
  const kept = tracks.slice(0, cutIndex);
  if (kept.length >= 3) {
    return { tracks: kept, stripped: tracks.length - kept.length, failures: belief.failures };
  }
  return { tracks, stripped: 0, failures: belief.failures };
}

/** V13 final pass — purity filter, checkpoint strip, sequence, honest partial cap. */
export function applyWorldPurityGate<T extends WorldIdentityTrack>(
  tracks: T[],
  committed: CommittedWorld | null,
  opts?: {
    prompt?: string;
    requestedLength?: number;
    coverageLevel?: CoverageLevel | null;
    preserveOpener?: boolean;
  },
): WorldPurityResult & { tracks: T[] } {
  const requested = Math.max(1, opts?.requestedLength ?? 25);
  const coverageLevel = opts?.coverageLevel ?? null;

  if (!committed?.hardLock || tracks.length === 0) {
    return {
      tracks,
      removed: 0,
      removedReasons: [],
      checkpointFailures: [],
      wouldStillBelieve: true,
      honestPartial: false,
      coverageMessage: null,
      salvageableCount: tracks.length,
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
      salvageableCount: tracks.length,
    };
  }

  const opener = opts?.preserveOpener && tracks.length > 0 ? tracks[0] : null;
  let working = [...tracks];
  const filtered = filterByWorldPurity(working, committed);
  if (filtered.removed > 0 && filtered.tracks.length >= 3) {
    working = filtered.tracks;
  }

  const stripped = stripFromCheckpointFailure(working, committed, profile);
  if (stripped.stripped > 0 && stripped.tracks.length >= 3) {
    working = stripped.tracks;
  }

  const belief = wouldStillBelieveSameCurator(opts?.prompt ?? "", working, committed, profile);

  if (opener && working.length > 0 && working[0] !== opener) {
    const rest = working.filter((t) => t !== opener);
    working = [opener, ...rest] as T[];
  }

  const sequenced = sequenceAfterPurityFilter(working, committed, profile) as T[];
  working = sequenced;

  const coverageCap =
    coverageLevel != null
      ? coverageLevelToMaxTracks(coverageLevel, requested)
      : requested;
  const honestPartial = working.length < requested;
  let salvageableCount = working.length;
  if (working.length > coverageCap) {
    salvageableCount = coverageCap;
    working = working.slice(0, coverageCap);
  }

  const coverageMessage =
    honestPartial && coverageLevel
      ? coverageUserMessage(coverageLevel)
      : honestPartial
        ? `Found ${working.length} track${working.length === 1 ? "" : "s"} that genuinely fit this world — publishing only those rather than padding with mismatched filler.`
        : null;

  return {
    tracks: working,
    removed: filtered.removed + stripped.stripped,
    removedReasons: [...filtered.removedReasons],
    checkpointFailures: belief.failures,
    wouldStillBelieve: belief.believe,
    honestPartial,
    coverageMessage,
    salvageableCount,
  };
}
