/**
 * Opening window lock — preserves Opening Curator v2 tracks 1–5 through finalization.
 *
 * Reorder-only protection. Does not rescore or retrieve candidates.
 */

import { OPENING_WINDOW_SIZE } from "./opening-curator-v2";

export const OPENING_LOCK_REASON = "opening_curator_v2" as const;
export const OPENING_LOCK_MIN_TRACKS = 6;

export type OpeningLock = {
  enabled: boolean;
  lockedTrackIds: string[];
  reason: typeof OPENING_LOCK_REASON;
};

export type OpeningLockViolation = {
  trackId: string;
  reason: string;
  action: "removed" | "reorder_blocked";
};

export type OpeningLockAuditDiagnostics = {
  openingLockApplied: boolean;
  openingLockViolations: OpeningLockViolation[];
  openingFinalOrderPreserved: boolean;
  openingLock?: OpeningLock;
};

export function createOpeningLock(
  tracks: ReadonlyArray<{ trackId: string }>,
  minTracks = OPENING_LOCK_MIN_TRACKS,
): OpeningLock | null {
  if (tracks.length < minTracks) return null;
  const lockedTrackIds = tracks.slice(0, OPENING_WINDOW_SIZE).map((track) => track.trackId);
  if (lockedTrackIds.length === 0) return null;
  return {
    enabled: true,
    lockedTrackIds,
    reason: OPENING_LOCK_REASON,
  };
}

export function isOpeningOrderPreserved(
  tracks: ReadonlyArray<{ trackId: string }>,
  lock: OpeningLock,
): boolean {
  if (lock.lockedTrackIds.length === 0) return true;
  const current = tracks.slice(0, lock.lockedTrackIds.length).map((track) => track.trackId);
  return lock.lockedTrackIds.every((id, index) => current[index] === id);
}

function detectOpeningReorderViolations<T extends { trackId: string }>(
  tracks: T[],
  lock: OpeningLock,
  violations: OpeningLockViolation[],
): void {
  const seen = new Set(violations.map((v) => `${v.trackId}:${v.action}:${v.reason}`));
  for (let index = 0; index < lock.lockedTrackIds.length; index += 1) {
    const id = lock.lockedTrackIds[index]!;
    const actualIndex = tracks.findIndex((track) => track.trackId === id);
    if (actualIndex >= 0 && actualIndex !== index) {
      const key = `${id}:reorder_blocked:opening_order_shuffle_detected`;
      if (!seen.has(key)) {
        violations.push({
          trackId: id,
          reason: "opening_order_shuffle_detected",
          action: "reorder_blocked",
        });
        seen.add(key);
      }
    }
  }
}

/**
 * Restore locked opening order at the front. Tail keeps relative order from input.
 */
export function enforceOpeningLock<T extends { trackId: string }>(
  tracks: T[],
  lock: OpeningLock,
  existingViolations: OpeningLockViolation[] = [],
): {
  tracks: T[];
  violations: OpeningLockViolation[];
  preserved: boolean;
} {
  const violations = [...existingViolations];
  detectOpeningReorderViolations(tracks, lock, violations);

  const byId = new Map(tracks.map((track) => [track.trackId, track]));
  const survivingLocked: T[] = [];
  for (const id of lock.lockedTrackIds) {
    const track = byId.get(id);
    if (track) {
      survivingLocked.push(track);
    } else if (!violations.some((v) => v.trackId === id && v.action === "removed")) {
      violations.push({
        trackId: id,
        reason: "locked_track_missing",
        action: "removed",
      });
    }
  }

  const lockedSet = new Set(survivingLocked.map((track) => track.trackId));
  const tail = tracks.filter((track) => !lockedSet.has(track.trackId));
  const merged = [...survivingLocked, ...tail];
  const effectiveLock: OpeningLock = {
    ...lock,
    lockedTrackIds: survivingLocked.map((track) => track.trackId),
  };

  return {
    tracks: merged,
    violations,
    preserved: isOpeningOrderPreserved(merged, effectiveLock),
  };
}

export function recordCriticalRemoval(
  lock: OpeningLock,
  removedTrackIds: string[],
  reason: string,
  violations: OpeningLockViolation[],
): OpeningLock {
  for (const id of removedTrackIds) {
    if (!lock.lockedTrackIds.includes(id)) continue;
    if (!violations.some((v) => v.trackId === id && v.reason === reason && v.action === "removed")) {
      violations.push({ trackId: id, reason, action: "removed" });
    }
  }
  return {
    ...lock,
    lockedTrackIds: lock.lockedTrackIds.filter((id) => !removedTrackIds.includes(id)),
  };
}

export function mergeTracksWithOpeningLock<T extends { trackId: string }>(
  after: T[],
  lock: OpeningLock,
  violations: OpeningLockViolation[],
  removalReason = "critical_validation_removal",
): {
  tracks: T[];
  lock: OpeningLock;
  violations: OpeningLockViolation[];
  preserved: boolean;
} {
  const removedIds = lock.lockedTrackIds.filter((id) => !after.some((track) => track.trackId === id));
  let updatedLock = lock;
  const updatedViolations = [...violations];
  if (removedIds.length > 0) {
    updatedLock = recordCriticalRemoval(updatedLock, removedIds, removalReason, updatedViolations);
  }
  const enforced = enforceOpeningLock(after, updatedLock, updatedViolations);
  return {
    tracks: enforced.tracks,
    lock: {
      ...updatedLock,
      lockedTrackIds: updatedLock.lockedTrackIds.filter((id) =>
        enforced.tracks.some((track) => track.trackId === id),
      ),
      enabled: updatedLock.enabled && updatedLock.lockedTrackIds.length > 0,
    },
    violations: enforced.violations,
    preserved: enforced.preserved,
  };
}

export function buildOpeningLockAuditDiagnostics(
  lock: OpeningLock | null,
  violations: OpeningLockViolation[],
  tracks: ReadonlyArray<{ trackId: string }>,
): OpeningLockAuditDiagnostics {
  const applied = lock?.enabled === true && (lock?.lockedTrackIds.length ?? 0) > 0;
  const preserved = lock ? isOpeningOrderPreserved(tracks, lock) : false;
  return {
    openingLockApplied: applied,
    openingLockViolations: violations,
    openingFinalOrderPreserved: preserved,
    ...(lock ? { openingLock: lock } : {}),
  };
}
