/**
 * Post-editorial human saveability gate with bounded retries (resample + re-audit).
 */

import type { LockedIntent } from "./v3/intent";
import type { SceneWorldContext } from "./scene-world-layer";
import {
  evaluateHumanSaveability,
  MAX_HUMAN_SAVE_RETRIES,
  type HumanSaveabilityEvaluation,
  type HumanSaveabilityTrack,
} from "./human-saveability-gate";
import {
  auditEditorialPlaylist,
  enforceOpeningSceneCluster,
  scorePlaylistWorldMetrics,
} from "./scene-world-editorial-audit";
import {
  computeSceneClusterMembershipScore,
  describeSceneClusterViolation,
} from "./scene-cohesion-clusters";
import { describeWorldRemovalReason } from "./scene-world-proof-capture";
import { interleaveLanes } from "./v3/interleaver";
import type { Lane } from "./v3/lane-router";
import type { ScorerTrack } from "./v3/lane-scorer";
import { selectFromClusters, type SampledLaneResult } from "./v3/v3-sampler";
import type { ClusteredPool } from "./v3/cluster-candidate-engine";

export type HumanSaveabilityPipelineResult<T extends HumanSaveabilityTrack> = {
  tracks: T[];
  evaluation: HumanSaveabilityEvaluation;
  retriesUsed: number;
  passed: boolean;
  editorialRemoved: Array<{
    title: string;
    artist: string;
    trackId: string;
    previousRank: number;
    worldMembershipScore: number;
    removalReason: string;
  }>;
  sceneWorldMetrics: ReturnType<typeof scorePlaylistWorldMetrics<T>> | null;
  failureAttribution: {
    firstOffendingTrackId: string | null;
    firstOffendingArtist: string | null;
    stageResponsible: "retrieval" | "scene world layer" | "cluster layer" | "sampler" | "interleaver" | "editorial audit";
    stageCounts: Record<string, number>;
    offendingTrackAttribution: Array<{
      trackId: string;
      artist: string;
      reason: string;
      stageResponsible: "retrieval" | "scene world layer" | "cluster layer" | "sampler" | "interleaver" | "editorial audit";
      suggestedFix: string;
    }>;
  };
};

export type LaneRetryArtifact = {
  lane: Lane;
  clusteredPool: ClusteredPool<ScorerTrack>;
  laneTarget: number;
};

function isExplorationOrContrastLane(lane: Lane): boolean {
  return lane.type === "contrast" || lane.id.includes("exploration");
}

function familyOf(track: HumanSaveabilityTrack): string {
  return (track.genreFamily ?? track.genrePrimary ?? "unknown").toLowerCase();
}

function suggestedFixForStage(stage: HumanSaveabilityPipelineResult<HumanSaveabilityTrack>["failureAttribution"]["stageResponsible"]): string {
  if (stage === "scene world layer") return "Enforce strict-mode primary-family filtering before clustering.";
  if (stage === "cluster layer") return "Raise strict cluster membership floor before sampler.";
  if (stage === "sampler") return "Disallow secondary clusters in strict mode and cap off-cluster picks to zero.";
  if (stage === "interleaver") return "Pin opening 5 to dominant micro-world in strict mode before editorial pass.";
  if (stage === "editorial audit") return "Constrain swaps to dominant cluster only in strict mode.";
  return "Tighten retrieval gating to strict archetype families.";
}

function stageForOffendingTrack(
  track: HumanSaveabilityTrack,
  reason: string,
  context: SceneWorldContext | null,
  strictHumanSave: boolean,
): HumanSaveabilityPipelineResult<HumanSaveabilityTrack>["failureAttribution"]["stageResponsible"] {
  if (!context?.active) return "sampler";
  const primaryFamilies = new Set((context.archetype?.genreFamilies ?? []).map((f) => f.toLowerCase()));
  if (strictHumanSave && primaryFamilies.size > 0 && !primaryFamilies.has(familyOf(track))) {
    return "scene world layer";
  }
  const clusterMembership = computeSceneClusterMembershipScore(track, context);
  if (clusterMembership < (strictHumanSave ? 0.78 : 0.68)) return "cluster layer";
  if (reason.includes("opening 5")) return "interleaver";
  const sourceLane = ((track as unknown as { sourceLane?: string }).sourceLane ?? "").toLowerCase();
  if (sourceLane.includes("exploration") || sourceLane.includes("contrast")) return "sampler";
  return "sampler";
}

function applyEditorialPass<T extends HumanSaveabilityTrack>(opts: {
  tracks: T[];
  candidates: T[];
  context: SceneWorldContext;
  targetCount: number;
  editorialRemoved: HumanSaveabilityPipelineResult<T>["editorialRemoved"];
}): T[] {
  const preAuditTracks = [...opts.tracks];
  const openingRepair = enforceOpeningSceneCluster({
    tracks: opts.tracks,
    candidates: opts.candidates,
    context: opts.context,
    openingSize: 10,
    maxSwaps: 10,
  });
  let working = openingRepair.tracks;
  for (const swap of openingRepair.swaps) {
    const fromTrack = preAuditTracks.find((track) => track.trackId === swap.fromTrackId);
    if (!fromTrack) continue;
    opts.editorialRemoved.push({
      title: fromTrack.trackName ?? fromTrack.trackId,
      artist: fromTrack.artistName ?? "Unknown",
      trackId: fromTrack.trackId,
      previousRank: preAuditTracks.findIndex((track) => track.trackId === swap.fromTrackId) + 1,
      worldMembershipScore: Math.round(swap.fromMembership * 1000) / 1000,
      removalReason: describeSceneClusterViolation(fromTrack, opts.context),
    });
  }
  const preEditorialTracks = [...working];
  const editorialAudit = auditEditorialPlaylist({
    tracks: working,
    candidates: opts.candidates,
    context: opts.context,
    maxSwaps: Math.max(10, Math.ceil(opts.targetCount * 0.25)),
  });
  for (const swap of editorialAudit.swaps) {
    const fromTrack = preEditorialTracks.find((track) => track.trackId === swap.fromTrackId);
    if (!fromTrack) continue;
    opts.editorialRemoved.push({
      title: fromTrack.trackName ?? fromTrack.trackId,
      artist: fromTrack.artistName ?? "Unknown",
      trackId: fromTrack.trackId,
      previousRank: preAuditTracks.findIndex((track) => track.trackId === swap.fromTrackId) + 1,
      worldMembershipScore: Math.round(swap.fromMembership * 1000) / 1000,
      removalReason: describeWorldRemovalReason(fromTrack, opts.context, swap.fromMembership),
    });
  }
  return editorialAudit.tracks;
}

export async function runHumanSaveabilityGateWithRetries<T extends HumanSaveabilityTrack>(opts: {
  prompt: string;
  lockedIntent: LockedIntent;
  initialTracks: T[];
  candidates: T[];
  context: SceneWorldContext | null;
  targetCount: number;
  strictHumanSave: boolean;
  laneRetryArtifacts: LaneRetryArtifact[];
  lanes: Lane[];
  sampledResults: SampledLaneResult<ScorerTrack>[];
  seed: string | number | undefined;
  lockedIntentForSampler: LockedIntent;
  sessionArtistMemory?: unknown;
  recentTrackPenalty?: Map<string, number>;
  cohesivePlaylist: boolean;
}): Promise<HumanSaveabilityPipelineResult<T>> {
  const editorialRemoved: HumanSaveabilityPipelineResult<T>["editorialRemoved"] = [];
  let tracks = [...opts.initialTracks];
  let evaluation = evaluateHumanSaveability(opts.prompt, tracks, opts.context, opts.lockedIntent);
  let retriesUsed = 0;

  const finalize = (working: T[]): T[] => {
    if (!opts.context?.active || working.length === 0) return working;
    return applyEditorialPass({
      tracks: working,
      candidates: opts.candidates,
      context: opts.context,
      targetCount: opts.targetCount,
      editorialRemoved,
    });
  };

  tracks = finalize(tracks);
  evaluation = evaluateHumanSaveability(opts.prompt, tracks, opts.context, opts.lockedIntent);

  while (!evaluation.humanSaveable && retriesUsed < MAX_HUMAN_SAVE_RETRIES) {
    retriesUsed += 1;
    const clusterFloor = retriesUsed >= 2 ? 0.82 : 0.74;
    const poolRatio = retriesUsed >= 2 ? 0.45 : 0.72;

    const retrySampled: SampledLaneResult<ScorerTrack>[] = [];
    for (const artifact of opts.laneRetryArtifacts) {
      if (opts.strictHumanSave && isExplorationOrContrastLane(artifact.lane)) continue;

      let scoredTracks = artifact.clusteredPool.scoredTracks;
      if (opts.context?.active) {
        scoredTracks = scoredTracks.filter(
          (decision) =>
            computeSceneClusterMembershipScore(
              decision.track as HumanSaveabilityTrack,
              opts.context!,
            ) >= clusterFloor,
        );
      }
      if (retriesUsed >= 2) {
        const keep = Math.max(artifact.laneTarget, Math.floor(scoredTracks.length * poolRatio));
        scoredTracks = scoredTracks.slice(0, keep);
      }
      if (scoredTracks.length === 0) continue;

      const pool: ClusteredPool<ScorerTrack> = { ...artifact.clusteredPool, scoredTracks };
      const clusterResult = selectFromClusters(
        pool,
        artifact.laneTarget,
        artifact.lane.id,
        `${opts.seed ?? "v3"}:human-save-retry-${retriesUsed}:${artifact.lane.id}`,
        {
          lockedIntent: opts.lockedIntentForSampler,
          sessionArtistMemory: opts.sessionArtistMemory as never,
          recentTrackPenalty: opts.recentTrackPenalty,
          sceneWorld: opts.context,
        },
      );
      retrySampled.push({
        laneId: artifact.lane.id,
        tracks: clusterResult.tracks,
      });
    }

    const activeLanes = opts.strictHumanSave
      ? opts.lanes.filter((lane) => !isExplorationOrContrastLane(lane))
      : opts.lanes;

    const interleaved = retrySampled.length > 0
      ? interleaveLanes(activeLanes, retrySampled, opts.targetCount, {
          cohesivePlaylist: opts.cohesivePlaylist || opts.strictHumanSave,
        })
      : interleaveLanes(opts.lanes, opts.sampledResults, opts.targetCount, {
          cohesivePlaylist: opts.cohesivePlaylist || opts.strictHumanSave,
        });

    tracks = finalize(interleaved.tracks as unknown as T[]);
    evaluation = evaluateHumanSaveability(opts.prompt, tracks, opts.context, opts.lockedIntent);
  }

  const sceneWorldMetrics = opts.context?.active
    ? scorePlaylistWorldMetrics(tracks, opts.context)
    : null;

  const trackById = new Map(tracks.map((track) => [track.trackId, track]));
  const offendingTrackAttribution = evaluation.offendingTracks.map((offender) => {
    const track = trackById.get(offender.trackId);
    if (!track) {
      return {
        trackId: offender.trackId,
        artist: offender.artist,
        reason: offender.reason,
        stageResponsible: "interleaver" as const,
        suggestedFix: suggestedFixForStage("interleaver"),
      };
    }
    const stage = stageForOffendingTrack(track, offender.reason, opts.context, opts.strictHumanSave);
    return {
      trackId: offender.trackId,
      artist: offender.artist,
      reason: offender.reason,
      stageResponsible: stage,
      suggestedFix: suggestedFixForStage(stage),
    };
  });
  const stageCounts: Record<string, number> = {};
  for (const row of offendingTrackAttribution) {
    stageCounts[row.stageResponsible] = (stageCounts[row.stageResponsible] ?? 0) + 1;
  }
  const firstOffender = [...evaluation.offendingTracks].sort((a, b) => a.rank - b.rank)[0] ?? null;
  const firstAttribution = firstOffender
    ? offendingTrackAttribution.find((row) => row.trackId === firstOffender.trackId)
    : null;

  return {
    tracks,
    evaluation,
    retriesUsed,
    passed: evaluation.humanSaveable,
    editorialRemoved,
    sceneWorldMetrics,
    failureAttribution: {
      firstOffendingTrackId: firstOffender?.trackId ?? null,
      firstOffendingArtist: firstOffender?.artist ?? null,
      stageResponsible: firstAttribution?.stageResponsible ?? "sampler",
      stageCounts,
      offendingTrackAttribution,
    },
  };
}
