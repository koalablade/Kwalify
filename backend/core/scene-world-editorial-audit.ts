/**
 * Editorial playlist audit — would this track feel out of place on a Spotify editorial playlist?
 */

import {
  blendScoreWithWorldMembership,
  computeWorldMembershipScore,
  type SceneWorldContext,
  type SceneWorldTrack,
} from "./scene-world-layer";
import {
  computeFirstTenClusterConsistency,
  computeSceneClusterMembershipScore,
  describeSceneClusterViolation,
  openingSceneClusterThreshold,
  shouldRejectForSceneCluster,
  trackBelongsToOpeningSceneCluster,
} from "./scene-cohesion-clusters";

export type EditorialAuditSwap = {
  fromTrackId: string;
  toTrackId: string;
  reason: string;
  fromMembership: number;
  toMembership: number;
};

export type EditorialAuditResult<T extends SceneWorldTrack> = {
  tracks: T[];
  swaps: EditorialAuditSwap[];
  outlierCount: number;
  firstTenCohesion: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function editorialOutlierThreshold(position: number, total: number): number {
  if (position < 10) return 0.62;
  if (position < total * 0.5) return 0.52;
  return 0.48;
}

function pickSceneReplacement<T extends SceneWorldTrack>(
  candidates: T[],
  used: Set<string>,
  context: SceneWorldContext,
  minCluster: number,
  minCombined: number,
): T | null {
  const ranked = candidates
    .filter((candidate) => !used.has(candidate.trackId))
    .map((candidate) => {
      const membership = computeWorldMembershipScore(candidate, context);
      const clusterMembership = computeSceneClusterMembershipScore(candidate, context);
      const combined = clamp01(membership * 0.52 + clusterMembership * 0.48);
      return { candidate, membership, clusterMembership, combined };
    })
    .filter((row) =>
      !shouldRejectForSceneCluster(row.candidate, context) &&
      row.clusterMembership >= minCluster &&
      row.combined >= minCombined,
    )
    .sort((a, b) =>
      b.clusterMembership - a.clusterMembership ||
      b.combined - a.combined,
    );
  return ranked[0]?.candidate ?? null;
}

export function enforceOpeningSceneCluster<T extends SceneWorldTrack>(opts: {
  tracks: T[];
  candidates: T[];
  context: SceneWorldContext;
  openingSize?: number;
  maxSwaps?: number;
}): EditorialAuditResult<T> {
  const openingSize = opts.openingSize ?? 10;
  const maxSwaps = opts.maxSwaps ?? 10;
  const working = [...opts.tracks];
  const used = new Set(working.map((track) => track.trackId));
  const swaps: EditorialAuditSwap[] = [];
  let outlierCount = 0;

  for (let i = 0; i < Math.min(openingSize, working.length); i++) {
    const track = working[i]!;
    if (trackBelongsToOpeningSceneCluster(track, opts.context, i)) continue;
    outlierCount++;

    const replacement = pickSceneReplacement(
      opts.candidates,
      used,
      opts.context,
      openingSceneClusterThreshold(i),
      editorialOutlierThreshold(i, working.length),
    );
    if (!replacement || swaps.length >= maxSwaps) continue;

    const fromMembership = computeSceneClusterMembershipScore(track, opts.context);
    const toMembership = computeSceneClusterMembershipScore(replacement, opts.context);
    swaps.push({
      fromTrackId: track.trackId,
      toTrackId: replacement.trackId,
      reason: "opening_scene_cluster_violation",
      fromMembership,
      toMembership,
    });
    used.delete(track.trackId);
    used.add(replacement.trackId);
    working[i] = replacement;
  }

  const firstTen = working.slice(0, 10);
  const firstTenCohesion = firstTen.length === 0
    ? 0
    : clamp01(
      firstTen.reduce((sum, row) => sum + computeSceneClusterMembershipScore(row, opts.context), 0) /
        firstTen.length,
    );

  return { tracks: working, swaps, outlierCount, firstTenCohesion };
}

export function auditEditorialPlaylist<T extends SceneWorldTrack>(opts: {
  tracks: T[];
  candidates: T[];
  context: SceneWorldContext;
  maxSwaps?: number;
}): EditorialAuditResult<T> {
  const maxSwaps = opts.maxSwaps ?? 8;
  const working = [...opts.tracks];
  const used = new Set(working.map((track) => track.trackId));
  const swaps: EditorialAuditSwap[] = [];
  let outlierCount = 0;

  for (let i = 0; i < working.length; i++) {
    const track = working[i]!;
    const membership = computeWorldMembershipScore(track, opts.context);
    const clusterMembership = computeSceneClusterMembershipScore(track, opts.context);
    const effectiveMembership = clamp01(membership * 0.52 + clusterMembership * 0.48);
    const threshold = editorialOutlierThreshold(i, working.length);
    if (effectiveMembership >= threshold && !shouldRejectForSceneCluster(track, opts.context)) continue;
    outlierCount++;

    const replacement = opts.candidates
      .filter((candidate) => !used.has(candidate.trackId))
      .map((candidate) => ({
        candidate,
        membership: computeWorldMembershipScore(candidate, opts.context),
        clusterMembership: computeSceneClusterMembershipScore(candidate, opts.context),
        score: blendScoreWithWorldMembership(candidate.energy ?? 0.5, computeWorldMembershipScore(candidate, opts.context), true),
      }))
      .filter((row) =>
        !shouldRejectForSceneCluster(row.candidate, opts.context) &&
        clamp01(row.membership * 0.52 + row.clusterMembership * 0.48) >= threshold + 0.04,
      )
      .sort((a, b) =>
        clamp01(b.membership * 0.52 + b.clusterMembership * 0.48) -
          clamp01(a.membership * 0.52 + a.clusterMembership * 0.48) ||
        b.score - a.score,
      )[0];

    if (!replacement || swaps.length >= maxSwaps) continue;

    swaps.push({
      fromTrackId: track.trackId,
      toTrackId: replacement.candidate.trackId,
      reason: "editorial_world_outlier",
      fromMembership: membership,
      toMembership: replacement.membership,
    });
    used.delete(track.trackId);
    used.add(replacement.candidate.trackId);
    working[i] = replacement.candidate;
  }

  const firstTen = working.slice(0, 10);
  const firstTenCohesion = firstTen.length === 0
    ? 0
    : clamp01(
      firstTen.reduce((sum, track) => {
        const membership = computeWorldMembershipScore(track, opts.context);
        const clusterMembership = computeSceneClusterMembershipScore(track, opts.context);
        return sum + clamp01(membership * 0.52 + clusterMembership * 0.48);
      }, 0) / firstTen.length,
    );

  return {
    tracks: working,
    swaps,
    outlierCount,
    firstTenCohesion,
  };
}

export function scorePlaylistWorldMetrics<T extends SceneWorldTrack>(
  tracks: T[],
  context: SceneWorldContext,
): {
  worldConsistency: number;
  archetypeConsistency: number;
  outlierCount: number;
  firstTenCohesion: number;
  firstTenClusterConsistency: number;
  clusterPurity: number;
  dominantSceneCluster: string | null;
  sceneClusterViolationsRemoved: number;
} {
  if (tracks.length === 0) {
    return {
      worldConsistency: 0,
      archetypeConsistency: 0,
      outlierCount: 0,
      firstTenCohesion: 0,
      firstTenClusterConsistency: 0,
      clusterPurity: context.sceneClusters?.clusterPurity ?? 0,
      dominantSceneCluster: context.sceneClusters?.dominantCluster.label ?? null,
      sceneClusterViolationsRemoved: 0,
    };
  }
  const memberships = tracks.map((track) => {
    const world = computeWorldMembershipScore(track, context);
    const cluster = computeSceneClusterMembershipScore(track, context);
    return clamp01(world * 0.52 + cluster * 0.48);
  });
  const worldConsistency = clamp01(memberships.reduce((sum, value) => sum + value, 0) / memberships.length);
  const outlierCount = memberships.filter((value, index) => value < editorialOutlierThreshold(index, tracks.length)).length;
  const firstTenCohesion = clamp01(
    memberships.slice(0, 10).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.min(10, tracks.length)),
  );
  const firstTenClusterConsistency = computeFirstTenClusterConsistency(tracks, context);
  const archetypeConsistency = clamp01(
    tracks.filter((track) => {
      const family = track.genreFamily ?? track.genrePrimary ?? "unknown";
      return context.archetype.genreFamilies.includes(family) ||
        context.archetype.secondaryFamilies.includes(family) ||
        family === "unknown";
    }).length / tracks.length,
  );
  return {
    worldConsistency,
    archetypeConsistency,
    outlierCount,
    firstTenCohesion,
    firstTenClusterConsistency,
    clusterPurity: context.sceneClusters?.clusterPurity ?? 0,
    dominantSceneCluster: context.sceneClusters?.dominantCluster.label ?? null,
    sceneClusterViolationsRemoved: 0,
  };
}
