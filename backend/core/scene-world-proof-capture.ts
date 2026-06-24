/**
 * Scene World Layer proof capture — before/after ranking diagnostics.
 */

import {
  computeWorldMembershipScore,
  type SceneWorldContext,
  type SceneWorldTrack,
} from "./scene-world-layer";
import { computeSceneClusterMembershipScore } from "./scene-cohesion-clusters";
import { getGenreFamily } from "./v3/global-diversity-controller";

export type SceneWorldProofTrackRow = {
  rank: number;
  trackId: string;
  title: string;
  artist: string;
  genreFamily: string;
  score: number;
  worldMembership: number | null;
  sceneClusterMembership: number | null;
};

export type SceneWorldProofRemoval = {
  title: string;
  artist: string;
  trackId: string;
  previousRank: number;
  worldMembershipScore: number;
  removalReason: string;
};

export type SceneWorldProofReport = {
  prompt: string;
  sceneWorldActive: boolean;
  archetype: {
    id: string;
    label: string;
    curatorVoice: string;
    genreFamilies: string[];
    candidateArchetypes: string[];
  } | null;
  top50Before: SceneWorldProofTrackRow[];
  top50After: SceneWorldProofTrackRow[];
  membershipFiltered: SceneWorldProofRemoval[];
  editorialRemoved: SceneWorldProofRemoval[];
  finalPlaylist: SceneWorldProofTrackRow[];
  candidateReplacementPct: number;
  worldMembershipDistribution: Array<{ bucket: string; count: number }>;
  firstTenCohesion: number;
  metrics: {
    worldConsistency: number;
    archetypeConsistency: number;
    outlierCount: number;
    firstTenClusterConsistency?: number;
    clusterPurity?: number;
    dominantSceneCluster?: string | null;
    sceneClusterViolationsRemoved?: number;
  } | null;
  dominantSceneCluster: string | null;
  clusterPurity: number;
  sceneClusterViolationsRemoved: number;
  firstTenClusterConsistency: number;
};

type RankedDecision<T> = {
  trackId: string;
  title: string;
  artist: string;
  genreFamily: string;
  score: number;
  worldMembership: number | null;
  sceneClusterMembership: number | null;
  track: T;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function familyOf(track: SceneWorldTrack): string {
  return getGenreFamily(track.genreFamily ?? track.genrePrimary ?? "unknown");
}

export function describeWorldRemovalReason(
  track: SceneWorldTrack,
  context: SceneWorldContext,
  membership: number,
): string {
  const family = familyOf(track);
  const energy = track.energy ?? 0.5;
  const valence = track.valence ?? 0.5;
  const { archetype, anchorStats } = context;

  if (archetype.excludedFamilies.includes(family)) {
    return `${family} / excluded from archetype world`;
  }
  if (
    family !== "unknown" &&
    !archetype.genreFamilies.includes(family) &&
    !archetype.secondaryFamilies.includes(family) &&
    !anchorStats.dominantFamilies.includes(family)
  ) {
    return `${family} / genre tourist`;
  }
  if (Math.abs(energy - anchorStats.avgEnergy) >= 0.28) {
    return "energy outlier vs anchor world";
  }
  if (Math.abs(valence - anchorStats.avgValence) >= 0.26) {
    if (valence < anchorStats.avgValence - 0.2) return "melancholic mismatch";
    return "valence outlier vs anchor world";
  }
  if (membership < 0.26) return "below world membership floor";
  if (membership < 0.45) return "narrative mismatch";
  return "editorial world outlier";
}

function membershipBucket(score: number): string {
  if (score >= 0.75) return "0.75+";
  if (score >= 0.60) return "0.60-0.74";
  if (score >= 0.45) return "0.45-0.59";
  if (score >= 0.30) return "0.30-0.44";
  return "<0.30";
}

function toRows<T>(ranked: RankedDecision<T>[], limit: number): SceneWorldProofTrackRow[] {
  return ranked.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    trackId: row.trackId,
    title: row.title,
    artist: row.artist,
    genreFamily: row.genreFamily,
    score: Math.round(row.score * 1000) / 1000,
    worldMembership: row.worldMembership == null ? null : Math.round(row.worldMembership * 1000) / 1000,
    sceneClusterMembership: row.sceneClusterMembership == null
      ? null
      : Math.round(row.sceneClusterMembership * 1000) / 1000,
  }));
}

export function buildSceneWorldProofReport<T extends SceneWorldTrack & {
  trackName?: string | null;
  artistName?: string | null;
}>(opts: {
  prompt: string;
  context: SceneWorldContext | null;
  beforeByTrack: Map<string, RankedDecision<T>>;
  afterByTrack: Map<string, RankedDecision<T>>;
  membershipFiltered: SceneWorldProofRemoval[];
  editorialRemoved: SceneWorldProofRemoval[];
  finalTracks: T[];
  metrics: SceneWorldProofReport["metrics"];
  firstTenCohesion: number;
  firstTenClusterConsistency?: number;
}): SceneWorldProofReport {
  const beforeRanked = [...opts.beforeByTrack.values()].sort((a, b) => b.score - a.score);
  const afterRanked = [...opts.afterByTrack.values()].sort((a, b) => b.score - a.score);
  const top50Before = toRows(beforeRanked, 50);
  const top50After = toRows(afterRanked, 50);

  const beforeIds = new Set(top50Before.map((row) => row.trackId));
  const afterIds = new Set(top50After.map((row) => row.trackId));
  let replaced = 0;
  for (const id of beforeIds) {
    if (!afterIds.has(id)) replaced++;
  }
  for (const id of afterIds) {
    if (!beforeIds.has(id)) replaced++;
  }
  const candidateReplacementPct = Math.round((replaced / Math.max(1, Math.min(50, beforeIds.size))) * 1000) / 10;

  const distribution = new Map<string, number>();
  for (const row of afterRanked.slice(0, 50)) {
    const membership = row.worldMembership ?? 0;
    const bucket = membershipBucket(membership);
    distribution.set(bucket, (distribution.get(bucket) ?? 0) + 1);
  }

  const context = opts.context;
  const finalPlaylist = opts.finalTracks.map((track, index) => {
    const membership = context?.active
      ? computeWorldMembershipScore(track, context)
      : null;
    const clusterMembership = context?.active
      ? computeSceneClusterMembershipScore(track, context)
      : null;
    return {
      rank: index + 1,
      trackId: track.trackId,
      title: track.trackName ?? track.trackId,
      artist: track.artistName ?? "Unknown",
      genreFamily: familyOf(track),
      score: 0,
      worldMembership: membership == null ? null : Math.round(membership * 1000) / 1000,
      sceneClusterMembership: clusterMembership == null ? null : Math.round(clusterMembership * 1000) / 1000,
    };
  });

  const sceneClusterViolationsRemoved = opts.membershipFiltered.filter((row) =>
    row.removalReason.includes("scene cluster") ||
    row.removalReason.includes("wrong scene cluster"),
  ).length;

  return {
    prompt: opts.prompt,
    sceneWorldActive: !!context?.active,
    archetype: context?.active
      ? {
          id: context.archetype.id,
          label: context.archetype.label,
          curatorVoice: context.archetype.curatorVoice,
          genreFamilies: context.archetype.genreFamilies,
          candidateArchetypes: context.candidateArchetypes.map((row) => row.label),
        }
      : null,
    top50Before,
    top50After,
    membershipFiltered: opts.membershipFiltered,
    editorialRemoved: opts.editorialRemoved,
    finalPlaylist,
    candidateReplacementPct,
    worldMembershipDistribution: [...distribution.entries()].map(([bucket, count]) => ({ bucket, count })),
    firstTenCohesion: Math.round(opts.firstTenCohesion * 1000) / 1000,
    metrics: opts.metrics,
    dominantSceneCluster: context?.sceneClusters?.dominantCluster.label ?? null,
    clusterPurity: Math.round((context?.sceneClusters?.clusterPurity ?? 0) * 1000) / 1000,
    sceneClusterViolationsRemoved,
    firstTenClusterConsistency: Math.round((opts.firstTenClusterConsistency ?? opts.metrics?.firstTenClusterConsistency ?? 0) * 1000) / 1000,
  };
}

export type SceneWorldProofAccumulator<T extends SceneWorldTrack & {
  trackName?: string | null;
  artistName?: string | null;
}> = {
  beforeByTrack: Map<string, RankedDecision<T>>;
  afterByTrack: Map<string, RankedDecision<T>>;
  membershipFiltered: SceneWorldProofRemoval[];
  membershipSeen: Set<string>;
};

export function createSceneWorldProofAccumulator<T extends SceneWorldTrack & {
  trackName?: string | null;
  artistName?: string | null;
}>(): SceneWorldProofAccumulator<T> {
  return {
    beforeByTrack: new Map(),
    afterByTrack: new Map(),
    membershipFiltered: [],
    membershipSeen: new Set(),
  };
}

export function recordSceneWorldProofBefore<T extends SceneWorldTrack & {
  trackName?: string | null;
  artistName?: string | null;
}>(
  acc: SceneWorldProofAccumulator<T>,
  track: T,
  score: number,
  genreFamily: string,
  worldMembership: number | null,
  sceneClusterMembership: number | null = null,
): void {
  const existing = acc.beforeByTrack.get(track.trackId);
  if (existing && existing.score >= score) return;
  acc.beforeByTrack.set(track.trackId, {
    trackId: track.trackId,
    title: track.trackName ?? track.trackId,
    artist: track.artistName ?? "Unknown",
    genreFamily,
    score,
    worldMembership,
    sceneClusterMembership,
    track,
  });
}

export function recordSceneWorldProofAfter<T extends SceneWorldTrack & {
  trackName?: string | null;
  artistName?: string | null;
}>(
  acc: SceneWorldProofAccumulator<T>,
  track: T,
  score: number,
  genreFamily: string,
  worldMembership: number,
  sceneClusterMembership: number | null = null,
): void {
  const existing = acc.afterByTrack.get(track.trackId);
  if (existing && existing.score >= score) return;
  acc.afterByTrack.set(track.trackId, {
    trackId: track.trackId,
    title: track.trackName ?? track.trackId,
    artist: track.artistName ?? "Unknown",
    genreFamily,
    score,
    worldMembership,
    sceneClusterMembership,
    track,
  });
}

export function recordSceneWorldMembershipRemoval<T extends SceneWorldTrack & {
  trackName?: string | null;
  artistName?: string | null;
}>(
  acc: SceneWorldProofAccumulator<T>,
  track: T,
  previousRank: number,
  membership: number,
  context: SceneWorldContext,
  customReason?: string,
): void {
  if (acc.membershipSeen.has(track.trackId)) return;
  acc.membershipSeen.add(track.trackId);
  acc.membershipFiltered.push({
    title: track.trackName ?? track.trackId,
    artist: track.artistName ?? "Unknown",
    trackId: track.trackId,
    previousRank,
    worldMembershipScore: Math.round(membership * 1000) / 1000,
    removalReason: customReason ?? describeWorldRemovalReason(track, context, membership),
  });
}

export function rankBeforeMembershipFilter<T extends SceneWorldTrack & {
  trackName?: string | null;
  artistName?: string | null;
}>(acc: SceneWorldProofAccumulator<T>, trackId: string): number {
  const ranked = [...acc.beforeByTrack.values()].sort((a, b) => b.score - a.score);
  const index = ranked.findIndex((row) => row.trackId === trackId);
  return index >= 0 ? index + 1 : ranked.length + 1;
}

export function computeReplacementPct(before: SceneWorldProofTrackRow[], after: SceneWorldProofTrackRow[]): number {
  const beforeIds = new Set(before.map((row) => row.trackId));
  const afterIds = new Set(after.map((row) => row.trackId));
  let changed = 0;
  for (const id of beforeIds) if (!afterIds.has(id)) changed++;
  for (const id of afterIds) if (!beforeIds.has(id)) changed++;
  return Math.round((changed / Math.max(1, Math.min(before.length, after.length, 50))) * 1000) / 10;
}

export function membershipDistributionFromRows(rows: SceneWorldProofTrackRow[]): Array<{ bucket: string; count: number }> {
  const distribution = new Map<string, number>();
  for (const row of rows) {
    const bucket = membershipBucket(row.worldMembership ?? 0);
    distribution.set(bucket, (distribution.get(bucket) ?? 0) + 1);
  }
  return [...distribution.entries()].map(([bucket, count]) => ({ bucket, count }));
}

export function averageMembership(rows: SceneWorldProofTrackRow[]): number {
  if (rows.length === 0) return 0;
  return clamp01(rows.reduce((sum, row) => sum + (row.worldMembership ?? 0), 0) / rows.length);
}
