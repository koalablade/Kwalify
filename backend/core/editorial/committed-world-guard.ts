/**
 * V14 — CommittedWorld immutability guard.
 * Resolve once at retrieval; downstream stages must not drift world identity.
 */

import type { CommittedWorld } from "../committed-world";

export type CommittedWorldFingerprint = {
  id: string;
  hardLock: boolean;
  worldIds: string[];
  source: string;
};

export function fingerprintCommittedWorld(committed: CommittedWorld | null): CommittedWorldFingerprint | null {
  if (!committed) return null;
  return {
    id: committed.id,
    hardLock: committed.hardLock,
    worldIds: [...committed.worldIds].sort(),
    source: committed.source,
  };
}

export function committedWorldsMatch(
  a: CommittedWorld | null,
  b: CommittedWorld | null,
): boolean {
  const fa = fingerprintCommittedWorld(a);
  const fb = fingerprintCommittedWorld(b);
  if (!fa && !fb) return true;
  if (!fa || !fb) return false;
  return (
    fa.id === fb.id &&
    fa.hardLock === fb.hardLock &&
    fa.source === fb.source &&
    fa.worldIds.length === fb.worldIds.length &&
    fa.worldIds.every((id, i) => id === fb.worldIds[i])
  );
}

export type WorldDriftReport = {
  stage: string;
  drifted: boolean;
  expected: CommittedWorldFingerprint | null;
  actual: CommittedWorldFingerprint | null;
};

/** Audit a pipeline stage — returns drift report without throwing. */
export function auditCommittedWorldStage(
  frozen: CommittedWorld | null,
  current: CommittedWorld | null,
  stage: string,
): WorldDriftReport {
  const expected = fingerprintCommittedWorld(frozen);
  const actual = fingerprintCommittedWorld(current);
  const drifted = !committedWorldsMatch(frozen, current);
  return { stage, drifted, expected, actual };
}

/** Prefer frozen world when re-resolution drifts — keeps CommittedWorld immutable. */
export function enforceCommittedWorldImmutability(
  frozen: CommittedWorld | null,
  current: CommittedWorld | null,
  stage: string,
): { world: CommittedWorld | null; drift: WorldDriftReport } {
  const drift = auditCommittedWorldStage(frozen, current, stage);
  if (drift.drifted && frozen) {
    return { world: frozen, drift };
  }
  return { world: current ?? frozen, drift };
}
