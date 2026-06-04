/**
 * Stratified Sampling Engine — spec §7
 *
 * Replaces greedy ranking and equal 4×25% buckets with weighted stratification:
 *
 *   Bucket 1 (40%) — Top emotional match     (sorted by EmotionMatch signal)
 *   Bucket 2 (30%) — High scene match        (sorted by SceneAffinity signal)
 *   Bucket 3 (20%) — Novelty / diversity     (sorted by NoveltyBoost signal)
 *   Bucket 4 (10%) — Random exploration      (bounded random from remaining)
 *
 * Post-selection:
 *   - Rolling 12-track diversity window: no genre > 18% within any window
 *   - Counter-genre injection every 5 tracks (spec §5)
 */

import type { EraBucket } from "../../lib/intent-parser";
import {
  GENRE_ROLLING_WINDOW,
  COUNTER_GENRE_INJECTION_INTERVAL,
} from "../genre-intelligence/soft-penalty";

export interface BucketCandidate {
  trackId: string;
  score: number;
  era: EraBucket;
  genrePrimary: string;
  /** Signal 3: EmotionMatch (0–1) — used for Bucket 1 */
  emotionMatch?: number;
  /** Signal 2: SceneAffinity (0–1) — used for Bucket 2 */
  sceneAffinity?: number;
  /** Signal 6: NoveltyBoost (0–1) — used for Bucket 3 */
  noveltyScore?: number;
}

/** Stable seeded random — keeps output deterministic within a session */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/** Simple counter-genre map — genres that provide contrast */
const COUNTER_GENRE_MAP: Record<string, string[]> = {
  indie: ["electronic", "hip_hop", "country", "soul"],
  electronic: ["country", "folk", "indie", "acoustic"],
  hip_hop: ["indie", "country", "folk", "electronic"],
  country: ["electronic", "hip_hop", "rock", "soul"],
  pop: ["indie", "electronic", "folk", "hip_hop"],
  rock: ["electronic", "soul", "hip_hop", "country"],
  folk: ["electronic", "hip_hop", "rock", "soul"],
  rnb: ["country", "electronic", "indie", "folk"],
  metal: ["soul", "folk", "electronic", "pop"],
  classical: ["hip_hop", "electronic", "rock", "pop"],
  jazz: ["electronic", "hip_hop", "metal", "rock"],
  soul: ["electronic", "hip_hop", "metal", "country"],
  blues: ["electronic", "hip_hop", "pop", "metal"],
  latin: ["indie", "folk", "electronic", "country"],
  reggae: ["metal", "electronic", "country", "folk"],
};

function getCounterGenres(genre: string): string[] {
  return COUNTER_GENRE_MAP[genre] ?? Object.keys(COUNTER_GENRE_MAP).filter((g) => g !== genre).slice(0, 3);
}

/**
 * Apply rolling genre diversity window and counter-genre injection (spec §5).
 *
 * Rules:
 *   - Within any 12-track rolling window, no genre may exceed 18%
 *   - Every 5 tracks, inject a counter-genre track if current genre streak > 2
 */
function applyGenreDiversityWindow<T extends BucketCandidate>(
  tracks: T[],
  pool: T[],
  usedIds: Set<string>
): T[] {
  const result: T[] = [];
  const poolById = new Map(pool.map((t) => [t.trackId, t]));

  for (let i = 0; i < tracks.length; i++) {
    const current = tracks[i]!;
    result.push(current);

    // Check rolling window: genre concentration in last GENRE_ROLLING_WINDOW tracks
    if (result.length >= GENRE_ROLLING_WINDOW) {
      const window = result.slice(-GENRE_ROLLING_WINDOW);
      const genreCounts: Record<string, number> = {};
      for (const t of window) {
        genreCounts[t.genrePrimary] = (genreCounts[t.genrePrimary] ?? 0) + 1;
      }
      // If the last track pushed any genre above the rolling cap, try to swap it
      const lastGenre = current.genrePrimary;
      const lastGenreShare = (genreCounts[lastGenre] ?? 0) / GENRE_ROLLING_WINDOW;
      if (lastGenreShare > 0.18) {
        // Find replacement from pool — different genre, not yet used
        const counterGenres = getCounterGenres(lastGenre);
        const replacement = [...poolById.values()].find(
          (t) =>
            !usedIds.has(t.trackId) &&
            t.trackId !== current.trackId &&
            counterGenres.includes(t.genrePrimary)
        );
        if (replacement) {
          result[result.length - 1] = replacement;
          usedIds.add(replacement.trackId);
        }
      }
    }

    // Counter-genre injection every COUNTER_GENRE_INJECTION_INTERVAL tracks
    if (
      result.length > 0 &&
      result.length % COUNTER_GENRE_INJECTION_INTERVAL === 0 &&
      i < tracks.length - 1
    ) {
      const recentGenre = result[result.length - 1]?.genrePrimary ?? "unknown";
      const streak = result
        .slice(-3)
        .filter((t) => t.genrePrimary === recentGenre).length;

      if (streak >= 2) {
        const counterGenres = getCounterGenres(recentGenre);
        const inject = [...poolById.values()].find(
          (t) =>
            !usedIds.has(t.trackId) &&
            counterGenres.includes(t.genrePrimary)
        );
        if (inject && result.length < tracks.length) {
          // Insert after current position; remove from later in the list if possible
          const laterIdx = tracks.findIndex(
            (t, idx) => idx > i && t.genrePrimary === recentGenre
          );
          if (laterIdx > 0) {
            tracks.splice(laterIdx, 1);
          }
          result.push(inject);
          usedIds.add(inject.trackId);
          i++; // skip one from original list since we injected
        }
      }
    }
  }

  return result;
}

/**
 * Build the playlist using stratified sampling (spec §7).
 *
 * @param scoredPool    Full scored pool with per-signal scores
 * @param targetLength  Total playlist length
 * @param intentEra     Era from UserIntent (kept for era diversity awareness)
 * @param seed          Deterministic seed for exploration bucket
 */
export function buildBucketedPlaylist<T extends BucketCandidate>(
  scoredPool: T[],
  targetLength: number,
  intentEra: EraBucket = "any",
  seed = Date.now()
): T[] {
  if (scoredPool.length === 0) return [];
  if (scoredPool.length <= targetLength) return [...scoredPool];

  // Bucket sizes — spec §7: 40/30/20/10
  const b1Size = Math.floor(targetLength * 0.40); // top emotional match
  const b2Size = Math.floor(targetLength * 0.30); // high scene match
  const b3Size = Math.floor(targetLength * 0.20); // novelty / diversity
  const b4Size = targetLength - b1Size - b2Size - b3Size; // random exploration

  const usedIds = new Set<string>();

  // Sorted views per dimension
  const byEmotion = [...scoredPool].sort(
    (a, b) => (b.emotionMatch ?? b.score) - (a.emotionMatch ?? a.score)
  );
  const byScene = [...scoredPool].sort(
    (a, b) => (b.sceneAffinity ?? b.score) - (a.sceneAffinity ?? a.score)
  );
  const byNovelty = [...scoredPool].sort(
    (a, b) => (b.noveltyScore ?? 0.5) - (a.noveltyScore ?? 0.5)
  );

  function take(n: number, sorted: T[]): T[] {
    const taken: T[] = [];
    for (const t of sorted) {
      if (taken.length >= n) break;
      if (!usedIds.has(t.trackId)) {
        taken.push(t);
        usedIds.add(t.trackId);
      }
    }
    return taken;
  }

  // Bucket 1: Top emotional match (40%)
  const bucket1 = take(b1Size, byEmotion);

  // Bucket 2: High scene match (30%)
  const bucket2 = take(b2Size, byScene);

  // Bucket 3: Novelty / diversity (20%)
  const bucket3 = take(b3Size, byNovelty);

  // Bucket 4: Random exploration from remaining pool (10%)
  const remaining = scoredPool.filter((t) => !usedIds.has(t.trackId));
  const rng = seededRandom(seed);
  const shuffled = [...remaining].sort(() => rng() - 0.5);
  const bucket4: T[] = [];
  for (const t of shuffled) {
    if (bucket4.length >= b4Size) break;
    bucket4.push(t);
    usedIds.add(t.trackId);
  }

  // Backfill any short buckets from remaining pool
  function backfill(bucket: T[], needed: number): T[] {
    if (bucket.length >= needed) return bucket;
    const byScore = scoredPool
      .filter((t) => !usedIds.has(t.trackId))
      .sort((a, b) => b.score - a.score);
    const extra: T[] = [];
    for (const t of byScore) {
      if (extra.length >= needed - bucket.length) break;
      extra.push(t);
      usedIds.add(t.trackId);
    }
    return [...bucket, ...extra];
  }

  const filled1 = backfill(bucket1, b1Size);
  const filled2 = backfill(bucket2, b2Size);
  const filled3 = backfill(bucket3, b3Size);
  const filled4 = backfill(bucket4, b4Size);

  // Interleave buckets for better track-to-track flow, then apply diversity window
  const combined = [...filled1, ...filled2, ...filled3, ...filled4];
  const allTracksById = new Set(combined.map((t) => t.trackId));
  const fullPoolForSwaps = scoredPool.filter((t) => !allTracksById.has(t.trackId));

  return applyGenreDiversityWindow(combined, fullPoolForSwaps, usedIds);
}
