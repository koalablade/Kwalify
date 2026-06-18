/**
 * Pre-publish coherence rebuild loop — swap repair, not reorder-only (H2).
 */

import type { LockedIntent } from "./v3/intent";
import type { SceneLockStatus } from "./scene-lock-mode";
import {
  COHERENCE_REPAIR_THRESHOLD,
  repairPlaylistIfNeeded,
  scorePlaylistCoherence,
  type CoherenceAuditTrack,
  type CoherenceSwapRecord,
  type PlaylistCoherenceScore,
} from "./playlist-coherence-audit";

export type RebuildLoopResult<T extends CoherenceAuditTrack> = {
  tracks: T[];
  coherenceScore: PlaylistCoherenceScore;
  swapRepairActions: CoherenceSwapRecord[];
  iterations: number;
  rebuildRequired: boolean;
};

export function runCoherenceRebuildLoop<T extends CoherenceAuditTrack>(opts: {
  tracks: T[];
  candidates: T[];
  intent: LockedIntent;
  scenePrediction?: Record<string, number>;
  sceneLock?: SceneLockStatus | null;
  maxIterations?: number;
  repairThreshold?: number;
}): RebuildLoopResult<T> {
  const maxIterations = opts.maxIterations ?? 2;
  const repairThreshold = opts.repairThreshold ?? COHERENCE_REPAIR_THRESHOLD;

  let working = [...opts.tracks];
  let coherenceScore = scorePlaylistCoherence(working, opts.intent, opts.scenePrediction);
  const swapRepairActions: CoherenceSwapRecord[] = [];
  let iterations = 0;

  if (coherenceScore.overallScore >= repairThreshold || working.length < 4 || opts.candidates.length === 0) {
    return {
      tracks: working,
      coherenceScore,
      swapRepairActions,
      iterations: 0,
      rebuildRequired: coherenceScore.overallScore < repairThreshold,
    };
  }

  while (iterations < maxIterations && coherenceScore.overallScore < repairThreshold) {
    const repair = repairPlaylistIfNeeded({
      tracks: working,
      candidates: opts.candidates.filter((c) => !working.some((t) => t.trackId === c.trackId)),
      intent: opts.intent,
      coherenceScore,
      scenePrediction: opts.scenePrediction,
      sceneLock: opts.sceneLock,
    });

    if (repair.swapRepairActions.length === 0) break;

    working = repair.tracks;
    coherenceScore = repair.coherenceScore;
    swapRepairActions.push(...repair.swapRepairActions);
    iterations++;
  }

  return {
    tracks: working,
    coherenceScore,
    swapRepairActions,
    iterations,
    rebuildRequired: coherenceScore.overallScore < repairThreshold,
  };
}
