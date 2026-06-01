/**
 * Hard rules — prevent genre collapse (identity lock, diversity floor, cluster cap).
 */

import type { RootGenre } from "./genre-taxonomy";
import type { TrackGenreClassification } from "./genre-taxonomy";
import { isGenreLocked, GENRE_LOCK_THRESHOLD } from "./genre-taxonomy";
import type { UserGenreVector } from "./user-genre-profile";

export const TOP_GENRE_MIN_SHARE = 0.08;
export const MICRO_CLUSTER_MAX_SHARE = 0.32;
export const SINGLE_GENRE_MAX_DOMINANCE = 0.55;

export function applyTopGenreDiversityFloor<T extends { trackId: string; score: number }>(
  tracks: T[],
  pool: T[],
  classifications: Map<string, TrackGenreClassification>,
  userVector: UserGenreVector,
  topN = 3
): { tracks: T[]; enforced: string[] } {
  const topGenres = (Object.entries(userVector) as [RootGenre, number][])
    .filter(([, v]) => (v ?? 0) >= 0.06)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([g]) => g);

  const enforced: string[] = [];
  let result = [...tracks];
  const used = new Set(result.map((t) => t.trackId));

  for (const genre of topGenres) {
    const hasGenre = result.some((t) => classifications.get(t.trackId)?.genreFamily === genre);
    if (hasGenre) continue;

    const candidate = pool
      .filter((t) => {
        if (used.has(t.trackId)) return false;
        return classifications.get(t.trackId)?.genreFamily === genre;
      })
      .sort((a, b) => b.score - a.score)[0];
    if (!candidate) continue;

    const replaceIdx = result.reduce(
      (worst, t, i) => {
        const f = classifications.get(t.trackId)?.genreFamily;
        const wShare = userVector[f ?? "unknown"] ?? 0;
        if (wShare > worst.share) return { idx: i, share: wShare };
        return worst;
      },
      { idx: result.length - 1, share: -1 }
    ).idx;

    if (replaceIdx >= 0) {
      used.delete(result[replaceIdx]!.trackId);
      result[replaceIdx] = candidate;
      used.add(candidate.trackId);
      enforced.push(genre);
    }
  }

  return { tracks: result, enforced };
}

export function identityLockActive(classification: TrackGenreClassification): boolean {
  return isGenreLocked(classification) || classification.confidenceScore >= GENRE_LOCK_THRESHOLD;
}

export function sceneOverrideAllowed(
  classification: TrackGenreClassification,
  sceneStrength: number
): boolean {
  if (identityLockActive(classification)) return sceneStrength < 0.45;
  return true;
}
