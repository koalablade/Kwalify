/**
 * Layer C — Clustering (emergent micro-genres from track embeddings).
 * v0: density-threshold greedy (HDBSCAN-like); upgrade path to HDBSCAN service.
 */

import {
  EMBEDDING_DIM,
  combineTrackEmbedding,
  cosineSimilarity,
  meanEmbedding,
  type TrackEmbeddingInput,
} from "./genre-embeddings";

export interface MicroGenre {
  id: string;
  centroid: number[];
  /** Alias: tracks in cluster */
  tracks: string[];
  sampleTrackIds: string[];
  discoveredLabels: string[];
  /** Alias for discoveredLabels */
  labels: string[];
  size: number;
}

const CLUSTER_MERGE_THRESHOLD = 0.82;
const MAX_CLUSTER_TRACKS = 600;
const MIN_CLUSTER_SIZE = 3;
const MAX_MICRO_GENRES = 80;

export function discoverMicroGenres(
  tracks: TrackEmbeddingInput[],
  maxClusters = MAX_MICRO_GENRES
): MicroGenre[] {
  const sample = tracks.length > MAX_CLUSTER_TRACKS
    ? reservoirSample(tracks, MAX_CLUSTER_TRACKS)
    : tracks;

  const items = sample.map((t) => ({
    trackId: t.trackId,
    embedding: combineTrackEmbedding(t),
    label: buildClusterLabel(t),
  }));

  const clusters: { ids: string[]; vectors: number[][]; labels: string[] }[] = [];

  for (const item of items) {
    let merged = false;
    for (const cluster of clusters) {
      const centroid = meanEmbedding(cluster.vectors);
      if (cosineSimilarity(item.embedding, centroid) >= CLUSTER_MERGE_THRESHOLD) {
        cluster.ids.push(item.trackId);
        cluster.vectors.push(item.embedding);
        cluster.labels.push(item.label);
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({ ids: [item.trackId], vectors: [item.embedding], labels: [item.label] });
    }
  }

  const micro: MicroGenre[] = [];
  let idx = 0;
  for (const c of clusters) {
    if (c.ids.length < MIN_CLUSTER_SIZE) continue;
    const centroid = meanEmbedding(c.vectors);
    const discoveredLabels = topLabels(c.labels);
    const trackIds = c.ids.slice(0, 12);
    micro.push({
      id: `micro_cluster_${idx++}`,
      centroid,
      tracks: trackIds,
      sampleTrackIds: trackIds,
      discoveredLabels,
      labels: discoveredLabels,
      size: c.ids.length,
    });
    if (micro.length >= maxClusters) break;
  }

  return micro.sort((a, b) => b.size - a.size);
}

function buildClusterLabel(t: TrackEmbeddingInput): string {
  const fam = t.classification?.genreFamily ?? "mixed";
  const e = t.energy ?? 0.5;
  const v = t.valence ?? 0.5;
  const mood = e < 0.35 ? "quiet" : e > 0.7 ? "energetic" : "mid";
  const tone = v < 0.4 ? "melancholic" : v > 0.6 ? "bright" : "neutral";
  return `${mood} ${tone} ${fam}`;
}

function topLabels(labels: string[]): string[] {
  const counts: Record<string, number> = {};
  for (const l of labels) counts[l] = (counts[l] ?? 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
}

function reservoirSample<T>(arr: T[], k: number): T[] {
  const result = arr.slice(0, k);
  for (let i = k; i < arr.length; i++) {
    const j = Math.floor(Math.random() * (i + 1));
    if (j < k) result[j] = arr[i]!;
  }
  return result;
}

/** No single micro-cluster > cap% of playlist */
export function enforceClusterDiversityCap<T extends { trackId: string }>(
  tracks: T[],
  trackEmbeddings: Map<string, number[]>,
  microGenres: MicroGenre[],
  maxClusterShare = 0.32
): { tracks: T[]; capped: string | null } {
  if (microGenres.length === 0 || tracks.length === 0) {
    return { tracks, capped: null };
  }

  const assignCluster = (emb: number[]): number => {
    let best = -1;
    let bestSim = -1;
    microGenres.forEach((mg, i) => {
      const sim = cosineSimilarity(emb, mg.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    });
    return bestSim >= 0.75 ? best : -1;
  };

  const counts = new Map<number, number>();
  for (const t of tracks) {
    const emb = trackEmbeddings.get(t.trackId);
    if (!emb) continue;
    const c = assignCluster(emb);
    if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
  }

  const limit = Math.ceil(tracks.length * maxClusterShare);
  let dominantCluster = -1;
  let dominantCount = 0;
  for (const [c, n] of counts) {
    if (n > dominantCount) {
      dominantCount = n;
      dominantCluster = c;
    }
  }

  if (dominantCount <= limit) return { tracks, capped: null };

  const out: T[] = [];
  let dropped = 0;
  for (const t of tracks) {
    const emb = trackEmbeddings.get(t.trackId);
    const c = emb ? assignCluster(emb) : -1;
    if (c === dominantCluster && dropped < dominantCount - limit) {
      dropped++;
      continue;
    }
    out.push(t);
  }

  return {
    tracks: out.length >= Math.floor(tracks.length * 0.7) ? out : tracks,
    capped: microGenres[dominantCluster]?.id ?? null,
  };
}
