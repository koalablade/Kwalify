/**
 * Human Saveability Gate — curator-level “would a human save this?” validation.
 * Not coherence scoring alone; intent fulfillment + single-aesthetic constraint.
 */

import type { LockedIntent } from "./v3/intent";
import {
  isSoftScenePrompt,
  computeWorldMembershipScore,
  type SceneWorldContext,
  type SceneWorldTrack,
} from "./scene-world-layer";
import {
  computeSceneClusterMembershipScore,
  computeFirstTenClusterConsistency,
  openingSceneClusterThreshold,
} from "./scene-cohesion-clusters";
import { scoreAgainstHumanPlaylistPatterns } from "./editorial/human-playlist-patterns";
import { humanPlausibilityScore } from "./editorial/playlist-local-search";
import type { PlaylistExecutionTrace } from "./observability/playlist-execution-trace";

export class HumanSaveabilityGateError extends Error {
  readonly code = "HUMAN_SAVEABILITY_GATE_FAILED";
  readonly evaluation: HumanSaveabilityEvaluation;
  readonly retriesUsed: number;
  readonly attribution: Record<string, unknown> | null;
  readonly playlistExecutionTrace: PlaylistExecutionTrace | null;

  constructor(
    evaluation: HumanSaveabilityEvaluation,
    retriesUsed: number,
    attribution: Record<string, unknown> | null = null,
    playlistExecutionTrace: PlaylistExecutionTrace | null = null,
  ) {
    const reasons = evaluation.rejectionReasons.slice(0, 3).join("; ") || "curator gate failed";
    super(`Human saveability gate failed after ${retriesUsed} retries: ${reasons}`);
    this.name = "HumanSaveabilityGateError";
    this.evaluation = evaluation;
    this.retriesUsed = retriesUsed;
    this.attribution = attribution;
    this.playlistExecutionTrace = playlistExecutionTrace;
  }
}

export const MIN_CURATOR_SCORE = 0.86;
export const MAX_HUMAN_SAVE_RETRIES = 2;

export type HumanSaveabilityTrack = SceneWorldTrack & {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  speechiness?: number | null;
  genreFamily?: string | null;
  genrePrimary?: string | null;
};

export type CuratorScoreBreakdown = {
  curatorScore: number;
  sceneClusterConsistency: number;
  emotionalTextureConsistency: number;
  sonicWorldUniqueness: number;
  opening5Stability: number;
};

export type HumanSaveabilityEvaluation = {
  humanSaveable: boolean;
  curatorScore: number;
  wouldSaveScore: number;
  humanPatternScore: number;
  breakdown: CuratorScoreBreakdown;
  rejectionReasons: string[];
  offendingTracks: Array<{
    trackId: string;
    title: string;
    artist: string;
    rank: number;
    reason: string;
  }>;
  strictModeHumanSaveability: boolean;
};

const MIN_WOULD_SAVE_STRICT = 0.78;
const MIN_WOULD_SAVE_RELAXED = 0.68;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function familyOf(track: HumanSaveabilityTrack): string {
  return (track.genreFamily ?? track.genrePrimary ?? "unknown").toLowerCase();
}

function textureBucket(track: HumanSaveabilityTrack): string {
  const acoustic = track.acousticness ?? 0.5;
  const dance = track.danceability ?? 0.5;
  if (acoustic >= 0.55) return "acoustic";
  if (dance >= 0.65) return "rhythmic";
  if (acoustic <= 0.25 && dance <= 0.45) return "dense";
  return "balanced";
}

function energyBand(track: HumanSaveabilityTrack): string {
  const e = track.energy ?? 0.5;
  if (e <= 0.42) return "low";
  if (e >= 0.58) return "high";
  return "mid";
}

function normalizedEntropy(labels: string[]): number {
  if (labels.length <= 1) return 0;
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  if (counts.size <= 1) return 0;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / labels.length;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h / Math.log2(counts.size);
}

export function strictModeHumanSaveability(vibe: string, lockedIntent: LockedIntent): boolean {
  return isSoftScenePrompt(vibe, lockedIntent);
}

export function computeCuratorScore(
  tracks: HumanSaveabilityTrack[],
  context: SceneWorldContext | null,
  strict: boolean,
): CuratorScoreBreakdown {
  if (tracks.length === 0) {
    return {
      curatorScore: 0,
      sceneClusterConsistency: 0,
      emotionalTextureConsistency: 0,
      sonicWorldUniqueness: 0,
      opening5Stability: 0,
    };
  }

  const sceneClusterConsistency = context?.sceneClusters
    ? clamp01(
      tracks.reduce((sum, t) => sum + computeSceneClusterMembershipScore(t, context), 0) / tracks.length,
    )
    : clamp01(1 - normalizedEntropy(tracks.map(familyOf)));

  const textures = tracks.map(textureBucket);
  const emotionalTextureConsistency = clamp01(1 - normalizedEntropy(textures));

  const families = tracks.map(familyOf).filter((f) => f !== "unknown");
  const familyCounts = new Map<string, number>();
  for (const f of families) familyCounts.set(f, (familyCounts.get(f) ?? 0) + 1);
  const sortedFamilies = [...familyCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dominantShare = sortedFamilies[0] ? sortedFamilies[0][1] / Math.max(1, tracks.length) : 0;
  const familyCount = familyCounts.size;
  let sonicWorldUniqueness = dominantShare;
  if (familyCount >= 3) sonicWorldUniqueness *= 0.35;
  else if (familyCount === 2 && strict) sonicWorldUniqueness *= 0.62;
  sonicWorldUniqueness = clamp01(sonicWorldUniqueness);

  const opening5 = tracks.slice(0, 5);
  let opening5Stability = 1;
  if (context?.sceneClusters && opening5.length > 0) {
    const dominantId = context.sceneClusters.dominantClusterId;
    const memberships = opening5.map((t, i) => ({
      cluster: context.sceneClusters!.trackToClusterId.get(t.trackId),
      score: computeSceneClusterMembershipScore(t, context),
      threshold: openingSceneClusterThreshold(i),
    }));
    const sameMicroWorld = memberships.every((row) => row.cluster === dominantId);
    const thresholdPass = memberships.every((row) => row.score >= row.threshold);
    const avgMembership = memberships.reduce((s, r) => s + r.score, 0) / memberships.length;
    opening5Stability = clamp01(
      avgMembership * (sameMicroWorld ? 1 : strict ? 0.45 : 0.72) * (thresholdPass ? 1 : 0.6),
    );
  } else {
    opening5Stability = clamp01(1 - normalizedEntropy(opening5.map(familyOf)));
  }

  const curatorScore = clamp01(
    sceneClusterConsistency * 0.40 +
    emotionalTextureConsistency * 0.30 +
    sonicWorldUniqueness * 0.20 +
    opening5Stability * 0.10,
  );

  return {
    curatorScore,
    sceneClusterConsistency,
    emotionalTextureConsistency,
    sonicWorldUniqueness,
    opening5Stability,
  };
}

function trackIntentSupportScore(
  track: HumanSaveabilityTrack,
  context: SceneWorldContext | null,
  strict: boolean,
): number {
  if (!context?.active) return 0.75;
  const world = computeWorldMembershipScore(track, context);
  const cluster = context.sceneClusters
    ? computeSceneClusterMembershipScore(track, context)
    : world;
  return clamp01(world * 0.48 + cluster * 0.52);
}

export function evaluateHumanSaveability(
  prompt: string,
  tracks: HumanSaveabilityTrack[],
  context: SceneWorldContext | null,
  lockedIntent: LockedIntent,
): HumanSaveabilityEvaluation {
  const strict = strictModeHumanSaveability(prompt, lockedIntent);
  const breakdown = computeCuratorScore(tracks, context, strict);
  const rejectionReasons: string[] = [];
  const offendingTracks: HumanSaveabilityEvaluation["offendingTracks"] = [];

  const clusterFloor = strict ? 0.78 : 0.68;
  const intentFloor = strict ? 0.72 : 0.62;

  if (!Number.isFinite(breakdown.curatorScore)) {
    rejectionReasons.push("evaluation_metadata_incomplete:curator_score_non_finite");
  } else if (breakdown.curatorScore < MIN_CURATOR_SCORE) {
    rejectionReasons.push(`curatorScore ${breakdown.curatorScore.toFixed(3)} < ${MIN_CURATOR_SCORE}`);
  }

  const families = new Set(tracks.map(familyOf).filter((f) => f !== "unknown"));
  const incompatiblePairs = [
    ["electronic", "folk"],
    ["electronic", "metal"],
    ["hip_hop", "folk"],
    ["metal", "indie"],
  ];
  for (const [a, b] of incompatiblePairs) {
    if (families.has(a) && families.has(b)) {
      rejectionReasons.push(`distinct sonic worlds: ${a} + ${b}`);
    }
  }
  if (strict && families.size > 1) {
    const primaryFamilies = context?.archetype?.genreFamilies ?? [];
    const allInPrimary = [...families].every((f) => primaryFamilies.includes(f));
    if (!allInPrimary) {
      rejectionReasons.push(`strict mode: genre families ${[...families].join(", ")} mix across primary world`);
    }
  }
  if (!strict && families.size >= 3) {
    rejectionReasons.push(`too many genre families (${families.size}) for single-curator aesthetic`);
  }

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    const rank = i + 1;
    const title = track.trackName ?? track.trackId;
    const artist = track.artistName ?? "Unknown";
    const support = trackIntentSupportScore(track, context, strict);
    const clusterScore = context?.sceneClusters
      ? computeSceneClusterMembershipScore(track, context)
      : support;

    if (clusterScore < clusterFloor) {
      offendingTracks.push({
        trackId: track.trackId,
        title,
        artist,
        rank,
        reason: `low scene cluster support (${clusterScore.toFixed(2)})`,
      });
    } else if (support < intentFloor) {
      offendingTracks.push({
        trackId: track.trackId,
        title,
        artist,
        rank,
        reason: `intent support too weak (${support.toFixed(2)}) — plausible but not curatorial`,
      });
    }

    if (rank <= 10 && i > 0) {
      const prev = tracks[i - 1]!;
      const energyJump = Math.abs((track.energy ?? 0.5) - (prev.energy ?? 0.5));
      const textureChange = textureBucket(track) !== textureBucket(prev);
      if (energyJump > 0.28 && textureChange) {
        offendingTracks.push({
          trackId: track.trackId,
          title,
          artist,
          rank,
          reason: `emotional texture shift (Δenergy=${energyJump.toFixed(2)}, texture jump)`,
        });
      }
    }
  }

  if (strict && context?.sceneClusters) {
    const opening5 = tracks.slice(0, 5);
    const dominantId = context.sceneClusters.dominantClusterId;
    for (let i = 0; i < opening5.length; i++) {
      const track = opening5[i]!;
      const clusterId = context.sceneClusters.trackToClusterId.get(track.trackId);
      if (clusterId !== dominantId) {
        offendingTracks.push({
          trackId: track.trackId,
          title: track.trackName ?? track.trackId,
          artist: track.artistName ?? "Unknown",
          rank: i + 1,
          reason: "opening 5 not in dominant micro-world",
        });
      }
    }
  }

  const humanPatternScore = scoreAgainstHumanPlaylistPatterns(tracks).score;
  const plausibilityScore = humanPlausibilityScore(tracks);
  if (strict && humanPatternScore < 0.52) {
    rejectionReasons.push(`human playlist pattern score ${humanPatternScore.toFixed(3)} < 0.52`);
  } else if (!strict && humanPatternScore < 0.42) {
    rejectionReasons.push(`human playlist pattern score ${humanPatternScore.toFixed(3)} < 0.42`);
  }

  const uniqueOffenders = new Map(offendingTracks.map((row) => [row.trackId, row]));
  const dedupedOffenders = [...uniqueOffenders.values()];

  let humanSaveable =
    rejectionReasons.length === 0 &&
    dedupedOffenders.length === 0 &&
    Number.isFinite(breakdown.curatorScore) &&
    breakdown.curatorScore >= MIN_CURATOR_SCORE;

  const wouldSaveScore = clamp01(
    humanPatternScore * 0.32 +
    plausibilityScore * 0.18 +
    breakdown.curatorScore * 0.44 +
    (humanSaveable ? 0.04 : 0),
  );
  const minWouldSave = strict ? MIN_WOULD_SAVE_STRICT : MIN_WOULD_SAVE_RELAXED;
  if (humanSaveable && wouldSaveScore < minWouldSave) {
    humanSaveable = false;
    rejectionReasons.push(`wouldSaveScore ${wouldSaveScore.toFixed(3)} < ${minWouldSave}`);
  }

  if (!humanSaveable && rejectionReasons.length === 0) {
    if (dedupedOffenders.length > 0) {
      const first = dedupedOffenders[0]!;
      rejectionReasons.push(`offending track rank ${first.rank}: ${first.reason} (${first.artist})`);
    } else if (!Number.isFinite(breakdown.curatorScore)) {
      rejectionReasons.push("evaluation_metadata_incomplete:curator_score_non_finite");
    } else if (breakdown.curatorScore < MIN_CURATOR_SCORE) {
      rejectionReasons.push(`curatorScore ${breakdown.curatorScore.toFixed(3)} < ${MIN_CURATOR_SCORE}`);
    } else {
      rejectionReasons.push("human saveability composite check failed without explicit curator rejection");
    }
  }

  return {
    humanSaveable,
    curatorScore: breakdown.curatorScore,
    wouldSaveScore,
    humanPatternScore,
    breakdown,
    rejectionReasons,
    offendingTracks: dedupedOffenders.slice(0, 20),
    strictModeHumanSaveability: strict,
  };
}

export function isHumanSaveablePlaylist(
  prompt: string,
  tracks: HumanSaveabilityTrack[],
  context: SceneWorldContext | null,
  lockedIntent: LockedIntent,
): boolean {
  return evaluateHumanSaveability(prompt, tracks, context, lockedIntent).humanSaveable;
}

export function firstTenClusterConsistencyForGate(
  tracks: HumanSaveabilityTrack[],
  context: SceneWorldContext | null,
): number {
  if (!context?.sceneClusters) return 0;
  return computeFirstTenClusterConsistency(tracks, context);
}

/** Observability helper — normalize gate evaluation for execution trace (no threshold changes). */
export function gateEvaluationForExecutionTrace(
  evaluation: HumanSaveabilityEvaluation,
): {
  humanSaveable: boolean;
  curatorScore: number | null;
  rejectionReasons: string[];
} {
  const curatorScore = Number.isFinite(evaluation.curatorScore) ? evaluation.curatorScore : null;
  const rejectionReasons = evaluation.rejectionReasons.filter((r) => r.length > 0 && r !== "unspecified");
  if (rejectionReasons.length > 0) {
    return { humanSaveable: evaluation.humanSaveable, curatorScore, rejectionReasons };
  }
  if (evaluation.humanSaveable) {
    return { humanSaveable: true, curatorScore, rejectionReasons: ["human_saveable:passed"] };
  }
  if (evaluation.offendingTracks.length > 0) {
    const first = evaluation.offendingTracks[0]!;
    return {
      humanSaveable: false,
      curatorScore,
      rejectionReasons: [`offending_track:${first.reason}`],
    };
  }
  if (curatorScore == null) {
    return {
      humanSaveable: false,
      curatorScore: null,
      rejectionReasons: ["curator_score:unavailable"],
    };
  }
  return {
    humanSaveable: false,
    curatorScore,
    rejectionReasons: ["gate_evaluation:failed_without_explicit_reasons"],
  };
}
