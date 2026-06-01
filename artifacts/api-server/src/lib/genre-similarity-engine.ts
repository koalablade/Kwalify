/**
 * Embedding-driven similarity search for playlist pools.
 */

import { cosineDistance, cosineSimilarity, combineTrackEmbedding, type TrackEmbeddingInput } from "./genre-embeddings";
import type { MicroGenre } from "./genre-clustering";
import type { RootGenre } from "./genre-taxonomy";

export interface SimilarityConstraints {
  genreBias?: Partial<Record<RootGenre, number>>;
  sceneBias?: number;
  energyMin?: number;
  energyMax?: number;
  valenceMin?: number;
  valenceMax?: number;
}

export interface SimilarTrackResult<T> {
  track: T;
  score: number;
  genreDistance: number;
  sceneMatch: number;
  userAffinity: number;
  surpriseFactor: number;
}

export function findSimilarTracks<T extends TrackEmbeddingInput>(
  seedEmbedding: number[],
  candidates: T[],
  opts: {
    constraints?: SimilarityConstraints;
    userVector?: Partial<Record<RootGenre, number>>;
    sceneMatchFn?: (t: T) => number;
    surpriseFn?: (t: T) => number;
    limit?: number;
  }
): SimilarTrackResult<T>[] {
  const c = opts.constraints ?? {};
  const results: SimilarTrackResult<T>[] = [];

  for (const track of candidates) {
    const e = track.energy ?? 0.5;
    const v = track.valence ?? 0.5;
    if (c.energyMin != null && e < c.energyMin) continue;
    if (c.energyMax != null && e > c.energyMax) continue;
    if (c.valenceMin != null && v < c.valenceMin) continue;
    if (c.valenceMax != null && v > c.valenceMax) continue;

    const emb = combineTrackEmbedding(track);
    const genreDistance = cosineDistance(seedEmbedding, emb);
    const genreScore = 1 - genreDistance;

    let genreBiasBoost = 0;
    const fam = track.classification?.genreFamily;
    if (fam && c.genreBias?.[fam]) genreBiasBoost = c.genreBias[fam]! * 0.15;
    if (fam && opts.userVector?.[fam]) genreBiasBoost += (opts.userVector[fam] ?? 0) * 0.1;

    const sceneMatch = opts.sceneMatchFn?.(track) ?? 0.5;
    const userAffinity = fam ? (opts.userVector?.[fam] ?? 0.05) * 2 : 0.1;
    const surpriseFactor = opts.surpriseFn?.(track) ?? 0.1;

    const score =
      (genreScore + genreBiasBoost) * 0.4 +
      sceneMatch * 0.3 +
      userAffinity * 0.2 +
      surpriseFactor * 0.1;

    results.push({
      track,
      score,
      genreDistance,
      sceneMatch,
      userAffinity,
      surpriseFactor,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? candidates.length);
}

export function buildSeedEmbeddingFromVibe(
  tracks: TrackEmbeddingInput[],
  vibe: string,
  userVector: Partial<Record<RootGenre, number>>
): number[] {
  const lower = vibe.toLowerCase();
  const matched = tracks.filter((t) => {
    const fam = t.classification?.genreFamily;
    if (!fam) return false;
    return (userVector[fam] ?? 0) > 0.08;
  });

  const pool = matched.length >= 5 ? matched.slice(0, 40) : tracks.slice(0, 40);
  const vectors = pool.map((t) => combineTrackEmbedding(t));
  if (vectors.length === 0) {
    return combineTrackEmbedding({
      trackId: "seed",
      trackName: lower,
      artistName: "",
      albumName: "",
      energy: 0.5,
      valence: 0.5,
      tempo: 120,
      danceability: 0.5,
      acousticness: 0.5,
    });
  }

  const sum = new Array(vectors[0]!.length).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < v.length; i++) sum[i]! += v[i]!;
  }
  const mag = Math.sqrt(sum.reduce((s, x) => s + x * x, 0)) || 1;
  return sum.map((x) => x / mag);
}

export function similarityBoostForPool<T extends { trackId: string; score: number }>(
  pool: T[],
  trackInputs: Map<string, TrackEmbeddingInput>,
  seedEmbedding: number[],
  weight = 0.12
): T[] {
  return pool
    .map((t) => {
      const input = trackInputs.get(t.trackId);
      if (!input) return t;
      const sim = 1 - cosineDistance(seedEmbedding, combineTrackEmbedding(input));
      return { ...t, score: t.score + sim * weight };
    })
    .sort((a, b) => b.score - a.score);
}
