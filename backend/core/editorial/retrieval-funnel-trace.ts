/**
 * V15 retrieval funnel trace — per-generation stage counts for auditMode diagnostics.
 */

export type RetrievalFunnelStage =
  | "totalLibrary"
  | "afterGenreFilter"
  | "afterArtistIdentityFilter"
  | "afterWorldFilter"
  | "afterScoring"
  | "afterFinalGate";

export type RetrievalFunnelSnapshot = Record<RetrievalFunnelStage, number>;

export type RetrievalFunnelTrace = {
  stages: RetrievalFunnelSnapshot;
  startedAt: number;
  completedAt: number | null;
  recoveryTriggered: boolean;
  recoveryLayer: string | null;
};

const EMPTY_SNAPSHOT = (): RetrievalFunnelSnapshot => ({
  totalLibrary: 0,
  afterGenreFilter: 0,
  afterArtistIdentityFilter: 0,
  afterWorldFilter: 0,
  afterScoring: 0,
  afterFinalGate: 0,
});

let activeFunnel: RetrievalFunnelTrace | null = null;

export function beginRetrievalFunnelTrace(totalLibrary: number): void {
  activeFunnel = {
    stages: {
      ...EMPTY_SNAPSHOT(),
      totalLibrary,
      afterGenreFilter: totalLibrary,
      afterArtistIdentityFilter: totalLibrary,
      afterWorldFilter: totalLibrary,
      afterScoring: totalLibrary,
      afterFinalGate: totalLibrary,
    },
    startedAt: Date.now(),
    completedAt: null,
    recoveryTriggered: false,
    recoveryLayer: null,
  };
}

export function recordFunnelStage(stage: RetrievalFunnelStage, count: number): void {
  if (!activeFunnel) return;
  activeFunnel.stages[stage] = Math.max(0, count);
}

export function markFunnelRecovery(layer: string): void {
  if (!activeFunnel) return;
  activeFunnel.recoveryTriggered = true;
  activeFunnel.recoveryLayer = layer;
}

export function finalizeRetrievalFunnel(afterFinalGate: number): RetrievalFunnelTrace | null {
  if (!activeFunnel) return null;
  activeFunnel.stages.afterFinalGate = Math.max(0, afterFinalGate);
  activeFunnel.completedAt = Date.now();
  const snapshot = { ...activeFunnel };
  activeFunnel = null;
  return snapshot;
}

export function getActiveRetrievalFunnel(): RetrievalFunnelTrace | null {
  return activeFunnel ? { ...activeFunnel, stages: { ...activeFunnel.stages } } : null;
}

export function peekRetrievalFunnel(): RetrievalFunnelTrace | null {
  return getActiveRetrievalFunnel();
}
