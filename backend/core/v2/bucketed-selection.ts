/**
 * V2 Bucketed Selection — anti-collapse playlist assembly.
 *
 * Instead of picking the global top N, distribute across 4 buckets:
 *
 *   Bucket 1 (25%) — Top genre cluster      (primary genre from user library)
 *   Bucket 2 (25%) — Secondary genre cluster (second most common genre)
 *   Bucket 3 (25%) — Era match cluster       (tracks matching intent era)
 *   Bucket 4 (25%) — Discovery              (random sample from top high-scorers not yet picked)
 *
 * This prevents "everything becomes indie / one genre collapse".
 * All tracks in all buckets must have audio features (guaranteed by V2 scorer).
 */

import type { EraBucket } from "../../lib/intent-parser";

export interface BucketCandidate {
  trackId: string;
  score: number;
  era: EraBucket;
  genrePrimary: string;
}

/** Stable seeded random — keeps output deterministic within a session */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/**
 * Find the top-1 and top-2 genres in the scored pool.
 * Used to define Buckets 1 and 2.
 */
function findTopGenres(tracks: BucketCandidate[]): [string, string] {
  const counts: Record<string, number> = {};
  for (const t of tracks) {
    if (!t.genrePrimary || t.genrePrimary === "unknown") continue;
    counts[t.genrePrimary] = (counts[t.genrePrimary] ?? 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top1 = sorted[0]?.[0] ?? "unknown";
  const top2 = sorted[1]?.[0] ?? sorted[0]?.[0] ?? "unknown";
  return [top1, top2];
}

/**
 * Build the playlist using 4 equal buckets.
 *
 * @param scoredPool  Full scored pool (already diversity-ranked)
 * @param targetLength  Total playlist length
 * @param intentEra   Era from UserIntent (for era-match bucket)
 * @param seed        Deterministic seed for discovery bucket
 */
export function buildBucketedPlaylist<T extends BucketCandidate>(
  scoredPool: T[],
  targetLength: number,
  intentEra: EraBucket = "any",
  seed = Date.now()
): T[] {
  if (scoredPool.length === 0) return [];
  if (scoredPool.length <= targetLength) return [...scoredPool];

  const sorted = [...scoredPool].sort((a, b) => b.score - a.score);
  const [genre1, genre2] = findTopGenres(sorted);

  // Bucket sizes — each gets 25%, with rounding absorbed by discovery bucket
  const b1Size = Math.floor(targetLength * 0.25);
  const b2Size = Math.floor(targetLength * 0.25);
  const b3Size = Math.floor(targetLength * 0.25);
  const b4Size = targetLength - b1Size - b2Size - b3Size;

  const usedIds = new Set<string>();

  // Helper: take up to N from pool matching predicate
  function take(n: number, predicate: (t: T) => boolean): T[] {
    const taken: T[] = [];
    for (const t of sorted) {
      if (taken.length >= n) break;
      if (!usedIds.has(t.trackId) && predicate(t)) {
        taken.push(t);
        usedIds.add(t.trackId);
      }
    }
    return taken;
  }

  // Bucket 1: top genre cluster
  const bucket1 = take(b1Size, (t) => t.genrePrimary === genre1);

  // Bucket 2: secondary genre cluster
  const bucket2 = take(b2Size, (t) => t.genrePrimary === genre2);

  // Bucket 3: era match cluster (use audio-estimated era if intent is "any")
  const bucket3 =
    intentEra === "any"
      ? take(b3Size, () => true) // just top scorers not yet picked
      : take(b3Size, (t) => t.era === intentEra);

  // Bucket 4: discovery — random sample from top 40% high-scorers not yet picked
  const topPool = sorted.filter((t) => !usedIds.has(t.trackId));
  const discoveryPool = topPool.slice(0, Math.max(topPool.length, b4Size * 3));
  const rng = seededRandom(seed);
  const shuffled = [...discoveryPool].sort(() => rng() - 0.5);
  const bucket4 = shuffled.slice(0, b4Size);
  for (const t of bucket4) usedIds.add(t.trackId);

  // If any bucket came up short, backfill from remaining pool
  function backfill(bucket: T[], needed: number): T[] {
    if (bucket.length >= needed) return bucket;
    const extra = take(needed - bucket.length, () => true);
    return [...bucket, ...extra];
  }

  const filled1 = backfill(bucket1, b1Size);
  const filled2 = backfill(bucket2, b2Size);
  const filled3 = backfill(bucket3, b3Size);
  const filled4 = backfill(bucket4, b4Size);

  return [...filled1, ...filled2, ...filled3, ...filled4];
}
