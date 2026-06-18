/**
 * Pre-publish coherence rebuild loop — constraint build first, swap repair as fallback.
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
import {
  buildPlaylistByWorldConstraints,
  isTrackInWorld,
  resolveWorldBoundary,
} from "./world-boundary";

export type RebuildLoopResult<T extends CoherenceAuditTrack> = {
  tracks: T[];
  coherenceScore: PlaylistCoherenceScore;
  swapRepairActions: CoherenceSwapRecord[];
  iterations: number;
  rebuildRequired: boolean;
  constraintBuildUsed: boolean;
};

export function runCoherenceRebuildLoop<T extends CoherenceAuditTrack>(opts: {
  tracks: T[];
  candidates: T[];
  intent: LockedIntent;
  scenePrediction?: Record<string, number>;
  sceneLock?: SceneLockStatus | null;
  sceneAliases?: string[];
  playlistLength?: number;
  maxPerArtist?: number;
  maxIterations?: number;
  repairThreshold?: number;
}): RebuildLoopResult<T> {
  const maxIterations = opts.maxIterations ?? 2;
  const repairThreshold = opts.repairThreshold ?? COHERENCE_REPAIR_THRESHOLD;
  const world = resolveWorldBoundary({
    sceneLock: opts.sceneLock ?? null,
    sceneAliases: opts.sceneAliases,
    scenePrediction: opts.scenePrediction,
  });

  let working = [...opts.tracks];
  let coherenceScore = scorePlaylistCoherence(working, opts.intent, opts.scenePrediction);
  const swapRepairActions: CoherenceSwapRecord[] = [];
  let iterations = 0;
  let constraintBuildUsed = false;

  const worldFilteredCandidates = world.active
    ? opts.candidates.filter((c) => isTrackInWorld(c, world, c.genreFamily ?? c.genrePrimary))
    : opts.candidates;

  if (world.active && worldFilteredCandidates.length >= Math.max(8, (opts.playlistLength ?? working.length))) {
    const constrained = buildPlaylistByWorldConstraints({
      candidates: [...working, ...worldFilteredCandidates.filter((c) => !working.some((t) => t.trackId === c.trackId))],
      intent: opts.intent,
      world,
      playlistLength: opts.playlistLength ?? working.length,
      scenePrediction: opts.scenePrediction,
      maxPerArtist: opts.maxPerArtist ?? 3,
    });
    if (
      constrained.tracks.length >= Math.min(working.length, 8) &&
      constrained.coherenceScore.overallScore >= coherenceScore.overallScore - 0.03
    ) {
      working = constrained.tracks;
      coherenceScore = constrained.coherenceScore;
      constraintBuildUsed = true;
    }
  }

  if (coherenceScore.overallScore >= repairThreshold || working.length < 4 || opts.candidates.length === 0) {
    return {
      tracks: working,
      coherenceScore,
      swapRepairActions,
      iterations: 0,
      rebuildRequired: coherenceScore.overallScore < repairThreshold,
      constraintBuildUsed,
    };
  }

  if (constraintBuildUsed && world.hardLock) {
    return {
      tracks: working,
      coherenceScore,
      swapRepairActions,
      iterations: 0,
      rebuildRequired: coherenceScore.overallScore < repairThreshold,
      constraintBuildUsed,
    };
  }

  while (iterations < maxIterations && coherenceScore.overallScore < repairThreshold) {
    const repair = repairPlaylistIfNeeded({
      tracks: working,
      candidates: worldFilteredCandidates.filter((c) => !working.some((t) => t.trackId === c.trackId)),
      intent: opts.intent,
      coherenceScore,
      scenePrediction: opts.scenePrediction,
      sceneLock: opts.sceneLock,
      sceneAliases: opts.sceneAliases,
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
    constraintBuildUsed,
  };
}
