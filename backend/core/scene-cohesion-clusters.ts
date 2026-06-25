/**
 * Scene Cohesion Clusters — sub-world identity within a scene archetype.
 *
 * Humans curate by scene identity, not genre families alone. After archetype
 * selection we cluster the retrieved library, pick a dominant scene cluster,
 * and score every candidate against that cluster.
 */

import { getGenreFamily } from "./v3/global-diversity-controller";
import type { SceneWorldContext, SceneWorldTrack, WorldAnchorTrack } from "./scene-world-layer";

export type SceneClusterSummary = {
  id: string;
  label: string;
  size: number;
  dominantArtists: string[];
  dominantGenres: string[];
  centroid: AudioCentroid;
};

export type SceneCohesionClusterContext = {
  clusters: Map<string, SceneClusterSummary>;
  trackToClusterId: Map<string, string>;
  dominantClusterId: string;
  dominantCluster: SceneClusterSummary;
  clusterPurity: number;
  adjacencyEdgeCount: number;
  coOccurrenceEdgeCount: number;
};

export type SceneCohesionTrack = SceneWorldTrack & {
  albumName?: string | null;
};

export type PlaylistAdjacencyInput = {
  trackIds: string[];
};

type AudioCentroid = {
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  tempo: number;
  speechiness: number;
};

class UnionFind {
  private parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    this.add(id);
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cursor = id;
    while (this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor)!;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }

  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const list = out.get(root) ?? [];
      list.push(id);
      out.set(root, list);
    }
    return out;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function feature(value: number | null | undefined, fallback = 0.5): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : fallback;
}

function normalizeArtist(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeGenre(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  return raw.length > 0 ? raw : "unknown";
}

function familyOf(track: SceneWorldTrack): string {
  return getGenreFamily(track.genreFamily ?? track.genrePrimary ?? "unknown");
}

function audioVector(track: SceneWorldTrack): number[] {
  return [
    feature(track.energy),
    feature(track.valence),
    feature(track.danceability),
    feature(track.acousticness),
    clamp01((track.tempo ?? 120) / 200),
    feature(track.speechiness),
  ];
}

function audioDistance(a: SceneWorldTrack, b: SceneWorldTrack): number {
  const va = audioVector(a);
  const vb = audioVector(b);
  let sum = 0;
  for (let i = 0; i < va.length; i++) sum += (va[i]! - vb[i]!) ** 2;
  return Math.sqrt(sum / va.length);
}

function buildCentroid(tracks: SceneCohesionTrack[]): AudioCentroid {
  if (tracks.length === 0) {
    return { energy: 0.5, valence: 0.5, danceability: 0.5, acousticness: 0.5, tempo: 120, speechiness: 0.5 };
  }
  const sum = tracks.reduce(
    (acc, track) => ({
      energy: acc.energy + feature(track.energy),
      valence: acc.valence + feature(track.valence),
      danceability: acc.danceability + feature(track.danceability),
      acousticness: acc.acousticness + feature(track.acousticness),
      tempo: acc.tempo + (track.tempo ?? 120),
      speechiness: acc.speechiness + feature(track.speechiness),
    }),
    { energy: 0, valence: 0, danceability: 0, acousticness: 0, tempo: 0, speechiness: 0 },
  );
  const n = tracks.length;
  return {
    energy: sum.energy / n,
    valence: sum.valence / n,
    danceability: sum.danceability / n,
    acousticness: sum.acousticness / n,
    tempo: sum.tempo / n,
    speechiness: sum.speechiness / n,
  };
}

function centroidDistance(track: SceneWorldTrack, centroid: AudioCentroid): number {
  const pseudo: SceneWorldTrack = {
    trackId: "centroid",
    energy: centroid.energy,
    valence: centroid.valence,
    danceability: centroid.danceability,
    acousticness: centroid.acousticness,
    tempo: centroid.tempo,
    speechiness: centroid.speechiness,
  };
  return audioDistance(track, pseudo);
}

function labelCluster(tracks: SceneCohesionTrack[]): { label: string; artists: string[]; genres: string[] } {
  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  for (const track of tracks) {
    const artist = normalizeArtist(track.artistName);
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    const genre = normalizeGenre(track.genrePrimary ?? track.genreFamily);
    if (genre !== "unknown") genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
  }
  const dominantArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([artist]) => artist);
  const dominantGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([genre]) => genre);
  const labelParts = [
    dominantArtists.slice(0, 2).join(" / ") || "mixed artists",
    dominantGenres[0] ?? "mixed genres",
  ];
  return { label: labelParts.join(" · "), artists: dominantArtists, genres: dominantGenres };
}

function bucketKey(track: SceneWorldTrack): string {
  const e = Math.floor(feature(track.energy) * 4);
  const v = Math.floor(feature(track.valence) * 4);
  const d = Math.floor(feature(track.danceability) * 4);
  return `${e}:${v}:${d}`;
}

function artistSharesGenreAndAudio(a: SceneCohesionTrack, b: SceneCohesionTrack): boolean {
  const ga = normalizeGenre(a.genrePrimary ?? a.genreFamily);
  const gb = normalizeGenre(b.genrePrimary ?? b.genreFamily);
  const sameFamily = familyOf(a) === familyOf(b) && familyOf(a) !== "unknown";
  const samePrimary = ga !== "unknown" && ga === gb;
  if (!sameFamily && !samePrimary) return false;
  return audioDistance(a, b) <= 0.18;
}

export function buildSceneCohesionClusters(
  tracks: SceneCohesionTrack[],
  opts?: {
    playlistAdjacency?: PlaylistAdjacencyInput[];
    likedAdjacency?: Array<{ trackId: string; addedAt?: string | Date | null }>;
  },
): SceneCohesionClusterContext | null {
  if (tracks.length < 4) return null;

  const uf = new UnionFind();
  for (const track of tracks) uf.add(track.trackId);

  const byArtist = new Map<string, SceneCohesionTrack[]>();
  const byAlbum = new Map<string, SceneCohesionTrack[]>();
  const byBucket = new Map<string, SceneCohesionTrack[]>();
  const byGenrePrimary = new Map<string, SceneCohesionTrack[]>();
  const trackById = new Map(tracks.map((track) => [track.trackId, track]));

  for (const track of tracks) {
    const artist = normalizeArtist(track.artistName);
    if (artist) {
      const list = byArtist.get(artist) ?? [];
      list.push(track);
      byArtist.set(artist, list);
    }
    const albumKey = `${normalizeArtist(track.artistName)}::${(track.albumName ?? "").toLowerCase().trim()}`;
    if (albumKey.endsWith("::") === false && track.albumName) {
      const list = byAlbum.get(albumKey) ?? [];
      list.push(track);
      byAlbum.set(albumKey, list);
    }
    const bucket = bucketKey(track);
    const bucketList = byBucket.get(bucket) ?? [];
    bucketList.push(track);
    byBucket.set(bucket, bucketList);
    const genre = normalizeGenre(track.genrePrimary ?? track.genreFamily);
    if (genre !== "unknown") {
      const genreList = byGenrePrimary.get(genre) ?? [];
      genreList.push(track);
      byGenrePrimary.set(genre, genreList);
    }
  }

  let adjacencyEdgeCount = 0;
  let coOccurrenceEdgeCount = 0;

  for (const group of byArtist.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        uf.union(group[i]!.trackId, group[j]!.trackId);
      }
    }
  }

  for (const group of byAlbum.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        uf.union(group[i]!.trackId, group[j]!.trackId);
      }
    }
  }

  for (const group of byGenrePrimary.values()) {
    if (group.length > 24) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (audioDistance(group[i]!, group[j]!) <= 0.20) {
          uf.union(group[i]!.trackId, group[j]!.trackId);
        }
      }
    }
  }

  for (const group of byBucket.values()) {
    if (group.length > 32) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (familyOf(a) === familyOf(b) && audioDistance(a, b) <= 0.14) {
          uf.union(a.trackId, b.trackId);
        }
      }
    }
  }

  const artistKeys = [...byArtist.keys()];
  for (let i = 0; i < artistKeys.length; i++) {
    for (let j = i + 1; j < artistKeys.length; j++) {
      const aTracks = byArtist.get(artistKeys[i]!) ?? [];
      const bTracks = byArtist.get(artistKeys[j]!) ?? [];
      let linked = false;
      for (const a of aTracks) {
        for (const b of bTracks) {
          if (artistSharesGenreAndAudio(a, b)) {
            uf.union(a.trackId, b.trackId);
            linked = true;
            break;
          }
        }
        if (linked) break;
      }
    }
  }

  for (const playlist of opts?.playlistAdjacency ?? []) {
    const ids = playlist.trackIds.filter((id) => trackById.has(id));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        uf.union(ids[i]!, ids[j]!);
        coOccurrenceEdgeCount++;
      }
    }
    for (let i = 0; i < ids.length - 1; i++) {
      uf.union(ids[i]!, ids[i + 1]!);
      adjacencyEdgeCount++;
    }
  }

  if (opts?.likedAdjacency?.length) {
    const sorted = [...opts.likedAdjacency]
      .filter((row) => trackById.has(row.trackId))
      .sort((a, b) => String(a.addedAt ?? "").localeCompare(String(b.addedAt ?? "")));
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = trackById.get(sorted[i]!.trackId);
      const b = trackById.get(sorted[i + 1]!.trackId);
      if (!a || !b) continue;
      if (familyOf(a) === familyOf(b) && audioDistance(a, b) <= 0.16) {
        uf.union(a.trackId, b.trackId);
        adjacencyEdgeCount++;
      }
    }
  }

  const groups = uf.groups();
  const clusters = new Map<string, SceneClusterSummary>();
  const trackToClusterId = new Map<string, string>();
  let clusterIndex = 0;
  for (const memberIds of groups.values()) {
    const members = memberIds.map((id) => trackById.get(id)!).filter(Boolean);
    if (members.length === 0) continue;
    const id = `scene:${clusterIndex++}`;
    const { label, artists, genres } = labelCluster(members);
    clusters.set(id, {
      id,
      label,
      size: members.length,
      dominantArtists: artists,
      dominantGenres: genres,
      centroid: buildCentroid(members),
    });
    for (const member of members) trackToClusterId.set(member.trackId, id);
  }

  if (clusters.size === 0) return null;

  const placeholderDominant = [...clusters.values()].sort((a, b) => b.size - a.size)[0]!;
  return {
    clusters,
    trackToClusterId,
    dominantClusterId: placeholderDominant.id,
    dominantCluster: placeholderDominant,
    clusterPurity: 0,
    adjacencyEdgeCount,
    coOccurrenceEdgeCount,
  };
}

function selectDominantCluster(
  index: SceneCohesionClusterContext,
  anchors: WorldAnchorTrack[],
  archetype: { genreFamilies: string[] },
  trackById: Map<string, SceneCohesionTrack>,
): SceneCohesionClusterContext {
  const primaryFamilies = new Set(archetype.genreFamilies);
  const clusterWeight = new Map<string, number>();
  for (const anchor of anchors) {
    const clusterId = index.trackToClusterId.get(anchor.trackId);
    if (!clusterId) continue;
    const track = trackById.get(anchor.trackId);
    const family = track ? familyOf(track) : "unknown";
    const primaryAnchor = primaryFamilies.has(family);
    const weight = anchor.anchorScore * (primaryAnchor ? 1 : 0.28);
    clusterWeight.set(clusterId, (clusterWeight.get(clusterId) ?? 0) + weight);
  }
  if (clusterWeight.size === 0) {
    const largest = [...index.clusters.values()].sort((a, b) => b.size - a.size)[0]!;
    return { ...index, dominantClusterId: largest.id, dominantCluster: largest, clusterPurity: 0 };
  }
  const dominantClusterId = [...clusterWeight.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const dominantCluster = index.clusters.get(dominantClusterId)!;
  const anchorInDominant = anchors.filter(
    (anchor) => index.trackToClusterId.get(anchor.trackId) === dominantClusterId,
  ).length;
  const clusterPurity = anchors.length > 0 ? anchorInDominant / anchors.length : 0;
  return { ...index, dominantClusterId, dominantCluster, clusterPurity };
}

export function enrichSceneWorldWithClusters(
  context: SceneWorldContext,
  tracks: SceneCohesionTrack[],
  opts?: {
    playlistAdjacency?: PlaylistAdjacencyInput[];
    likedAdjacency?: Array<{ trackId: string; addedAt?: string | Date | null }>;
  },
): SceneWorldContext {
  const built = buildSceneCohesionClusters(tracks, opts);
  if (!built) return { ...context, sceneClusters: null };
  const trackById = new Map(tracks.map((track) => [track.trackId, track]));
  const sceneClusters = selectDominantCluster(built, context.anchors, context.archetype, trackById);
  return { ...context, sceneClusters };
}

function sharesArtistWithCluster(
  track: SceneWorldTrack,
  cluster: SceneClusterSummary,
): boolean {
  const artist = normalizeArtist(track.artistName);
  if (!artist) return false;
  return cluster.dominantArtists.some((row) => row === artist);
}

function clustersShareSceneIdentity(a: SceneClusterSummary, b: SceneClusterSummary): boolean {
  const genreOverlap = a.dominantGenres.some((genre) => b.dominantGenres.includes(genre));
  if (genreOverlap) return true;
  const dist = Math.sqrt(
    (a.centroid.energy - b.centroid.energy) ** 2 +
    (a.centroid.valence - b.centroid.valence) ** 2 +
    (a.centroid.danceability - b.centroid.danceability) ** 2 +
    (a.centroid.acousticness - b.centroid.acousticness) ** 2,
  );
  return dist <= 0.11;
}

function isAdjacentCluster(
  track: SceneWorldTrack,
  index: SceneCohesionClusterContext,
): boolean {
  const clusterId = index.trackToClusterId.get(track.trackId);
  if (!clusterId || clusterId === index.dominantClusterId) return clusterId === index.dominantClusterId;
  const cluster = index.clusters.get(clusterId);
  if (!cluster) return false;
  if (!clustersShareSceneIdentity(cluster, index.dominantCluster)) return false;
  if (sharesArtistWithCluster(track, index.dominantCluster)) return true;
  const dist = centroidDistance(track, index.dominantCluster.centroid);
  return dist <= 0.11;
}

export function computeSceneClusterMembershipScore(
  track: SceneWorldTrack,
  context: SceneWorldContext,
): number {
  const index = context.sceneClusters;
  if (!index) return 1;

  const clusterId = index.trackToClusterId.get(track.trackId);
  if (clusterId === index.dominantClusterId) return 1;
  if (context.anchorTrackIds.has(track.trackId) && clusterId === index.dominantClusterId) return 0.98;

  const family = familyOf(track);
  const archetypeFamilies = [
    ...context.archetype.genreFamilies,
    ...context.archetype.secondaryFamilies,
    ...context.anchorStats.dominantFamilies,
  ];
  const familyInWorld = archetypeFamilies.includes(family);

  const audioFit = 1 - Math.min(1, centroidDistance(track, index.dominantCluster.centroid) * 2.8);
  const adjacent = isAdjacentCluster(track, index);

  if (adjacent) return clamp01(0.68 + audioFit * 0.24);

  if (family === "unknown") {
    if (sharesArtistWithCluster(track, index.dominantCluster)) {
      return clamp01(0.58 + audioFit * 0.22);
    }
    return clamp01(Math.min(0.42, audioFit * 0.40));
  }

  if (familyInWorld) {
    const cluster = clusterId ? index.clusters.get(clusterId) : null;
    const samePrimaryFamily = context.archetype.genreFamilies.includes(family);
    if (!samePrimaryFamily && cluster && !clustersShareSceneIdentity(cluster, index.dominantCluster)) {
      return clamp01(0.12 + audioFit * 0.22);
    }
    return clamp01(0.18 + audioFit * 0.32);
  }

  return clamp01(audioFit * 0.22);
}

export function openingSceneClusterThreshold(position: number): number {
  if (position < 5) return 0.85;
  if (position < 10) return 0.72;
  return 0.58;
}

export function trackBelongsToOpeningSceneCluster(
  track: SceneWorldTrack,
  context: SceneWorldContext,
  position: number,
): boolean {
  if (!context.sceneClusters) return true;
  if (shouldRejectForSceneCluster(track, context)) return false;
  return computeSceneClusterMembershipScore(track, context) >= openingSceneClusterThreshold(position);
}

export function isSecondaryGenreFamilyOnly(track: SceneWorldTrack, context: SceneWorldContext): boolean {
  const family = familyOf(track);
  return (
    !context.archetype.genreFamilies.includes(family) &&
    context.archetype.secondaryFamilies.includes(family)
  );
}

export function trackMatchesGenreFamilyButWrongSceneCluster(
  track: SceneWorldTrack,
  context: SceneWorldContext,
): boolean {
  if (!context.sceneClusters) return false;
  const family = familyOf(track);
  const archetypeFamilies = [
    ...context.archetype.genreFamilies,
    ...context.archetype.secondaryFamilies,
    ...context.anchorStats.dominantFamilies,
  ];
  const familyInWorld =
    archetypeFamilies.includes(family) ||
    context.anchorStats.dominantFamilies.includes(family);
  if (!familyInWorld || family === "unknown") return false;
  const clusterId = context.sceneClusters.trackToClusterId.get(track.trackId);
  if (clusterId === context.sceneClusters.dominantClusterId) return false;
  return computeSceneClusterMembershipScore(track, context) < 0.58;
}

export function shouldRejectForSceneCluster(
  track: SceneWorldTrack,
  context: SceneWorldContext,
): boolean {
  if (!context.sceneClusters) return false;
  const score = computeSceneClusterMembershipScore(track, context);
  const family = familyOf(track);

  if (context.strictMode && isSecondaryGenreFamilyOnly(track, context) && score < 0.72) {
    return true;
  }
  if (family === "unknown" && score < 0.55) return true;
  if (trackMatchesGenreFamilyButWrongSceneCluster(track, context)) return true;
  if (score < 0.38) return true;
  return false;
}

export function describeSceneClusterViolation(
  track: SceneWorldTrack,
  context: SceneWorldContext,
): string {
  const index = context.sceneClusters;
  if (!index) return "scene cluster inactive";
  const clusterId = index.trackToClusterId.get(track.trackId) ?? "unclustered";
  const cluster = index.clusters.get(clusterId);
  const score = computeSceneClusterMembershipScore(track, context);
  const family = familyOf(track);
  if (family === "unknown" && score < 0.55) {
    return `unknown metadata / no scene cluster proof (score=${score.toFixed(2)})`;
  }
  if (trackMatchesGenreFamilyButWrongSceneCluster(track, context)) {
    return `${family} genre family match but wrong scene cluster (${cluster?.label ?? clusterId} vs ${index.dominantCluster.label})`;
  }
  return `scene cluster mismatch (${cluster?.label ?? clusterId}, score=${score.toFixed(2)})`;
}

export function computeFirstTenClusterConsistency<T extends SceneWorldTrack>(
  tracks: T[],
  context: SceneWorldContext,
): number {
  const firstTen = tracks.slice(0, 10);
  if (firstTen.length === 0 || !context.sceneClusters) return 0;
  const sum = firstTen.reduce(
    (acc, track) => acc + computeSceneClusterMembershipScore(track, context),
    0,
  );
  return clamp01(sum / firstTen.length);
}

export type SceneClusterFunnelStage =
  | "full_library"
  | "retrieval"
  | "retrieval_dominant_filter"
  | "world_layer"
  | "primary_family"
  | "strict_cluster_filter"
  | "sampler_pool"
  | "opening5_pre_interleaver"
  | "opening5_post_interleaver";

export type SceneClusterFunnelReport = {
  dominantClusterId: string | null;
  dominantClusterLabel: string | null;
  dominantClusterSizeFullLibrary: number;
  dominantClusterShifted: boolean;
  preRetrievalDominantId: string | null;
  postRetrievalDominantId: string | null;
  retrievalDominantFilterApplied: boolean;
  worldLockedFromFullLibrary: boolean;
  counts: Record<SceneClusterFunnelStage, number>;
  earliestCollapseStage: SceneClusterFunnelStage | null;
};

export function countTracksInDominantSceneCluster(
  trackIds: Iterable<string>,
  context: SceneWorldContext | null,
): number {
  if (!context?.sceneClusters) return 0;
  const dominantId = context.sceneClusters.dominantClusterId;
  let count = 0;
  for (const id of trackIds) {
    if (context.sceneClusters.trackToClusterId.get(id) === dominantId) count++;
  }
  return count;
}

export function dominantClusterSize(context: SceneWorldContext | null): number {
  if (!context?.sceneClusters) return 0;
  return context.sceneClusters.dominantCluster.size;
}

export function buildSceneClusterFunnelReport(
  counts: Record<SceneClusterFunnelStage, number>,
  opts: {
    context: SceneWorldContext | null;
    preRetrievalContext: SceneWorldContext | null;
    postRetrievalRebuiltContext: SceneWorldContext | null;
    retrievalDominantFilterApplied: boolean;
    worldLockedFromFullLibrary: boolean;
    opening5PreInterleaver: number;
    opening5PostInterleaver: number;
  },
): SceneClusterFunnelReport {
  const dominantClusterId = opts.context?.sceneClusters?.dominantClusterId ?? null;
  const dominantClusterLabel = opts.context?.sceneClusters?.dominantCluster.label ?? null;
  const preRetrievalDominantId = opts.preRetrievalContext?.sceneClusters?.dominantClusterId ?? null;
  const postRetrievalDominantId = opts.postRetrievalRebuiltContext?.sceneClusters?.dominantClusterId ?? null;
  const dominantClusterShifted = !!(
    preRetrievalDominantId &&
    postRetrievalDominantId &&
    preRetrievalDominantId !== postRetrievalDominantId
  );

  const orderedStages: SceneClusterFunnelStage[] = [
    "full_library",
    "retrieval",
    "retrieval_dominant_filter",
    "world_layer",
    "primary_family",
    "strict_cluster_filter",
    "sampler_pool",
    "opening5_pre_interleaver",
    "opening5_post_interleaver",
  ];
  let earliestCollapseStage: SceneClusterFunnelStage | null = null;
  for (let i = 1; i < orderedStages.length; i++) {
    const prev = counts[orderedStages[i - 1]!] ?? 0;
    const curr = counts[orderedStages[i]!] ?? 0;
    if (prev >= 5 && curr < 5) {
      earliestCollapseStage = orderedStages[i]!;
      break;
    }
  }

  return {
    dominantClusterId,
    dominantClusterLabel,
    dominantClusterSizeFullLibrary: dominantClusterSize(opts.preRetrievalContext),
    dominantClusterShifted,
    preRetrievalDominantId,
    postRetrievalDominantId,
    retrievalDominantFilterApplied: opts.retrievalDominantFilterApplied,
    worldLockedFromFullLibrary: opts.worldLockedFromFullLibrary,
    counts: {
      ...counts,
      opening5_pre_interleaver: opts.opening5PreInterleaver,
      opening5_post_interleaver: opts.opening5PostInterleaver,
    },
    earliestCollapseStage,
  };
}

export function countSceneClusterViolationsRemoved(
  removed: Array<{ removalReason?: string }>,
): number {
  return removed.filter((row) =>
    (row.removalReason ?? "").includes("scene cluster") ||
    (row.removalReason ?? "").includes("wrong scene cluster"),
  ).length;
}
