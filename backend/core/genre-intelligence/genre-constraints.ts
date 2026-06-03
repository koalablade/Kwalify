/**
 * Hard genre constraints — mandatory floors, caps, and diversity rules.
 */

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { UserGenreVector } from "../../lib/user-genre-profile";

/** Max share any single genre may occupy in a final playlist */
export const MAX_GENRE_DOMINANCE = 0.35;

/** Min distinct genre families when library has enough variety */
export const MIN_DISTINCT_GENRES_IN_PLAYLIST = 6;

/** Library share threshold — genre must appear in playlist if user has ≥ this share */
export const GENRE_LIBRARY_FLOOR = 0.05;

/** Scene layer may contribute at most this fraction of combined score influence */
/** Scene cap — enough to feel directional, not enough to override genre */
export const MAX_SCENE_SCORE_INFLUENCE = 0.38;

export const SCORING_WEIGHTS = {
  genre: 0.42,
  scene: 0.25,
  emotion: 0.22,
  library: 0.11,
} as const;

const GENERIC_COLLAPSE_GENRES: RootGenre[] = ["indie", "pop"];

export function requireTrackClassification(
  trackId: string,
  classifications: Map<string, TrackGenreClassification>,
  fallback: () => TrackGenreClassification
): TrackGenreClassification {
  const existing = classifications.get(trackId);
  if (existing && existing.genrePrimary !== "unknown") return existing;
  const c = fallback();
  classifications.set(trackId, c);
  return c;
}

export function countDistinctGenres(
  trackIds: string[],
  classifications: Map<string, TrackGenreClassification>
): number {
  const set = new Set<RootGenre>();
  for (const id of trackIds) {
    const c = classifications.get(id);
    if (!c || c.genreFamily === "unknown") continue;
    set.add(c.genreFamily);
  }
  return set.size;
}

/** 0–1 — higher = more even spread across represented genres */
export function computeDiversityScore(dist: Record<string, number>): number {
  const values = Object.values(dist).filter((v) => v > 0);
  if (values.length <= 1) return values.length === 1 ? 0.35 : 0;
  const h = values.reduce((s, p) => s - p * Math.log2(p), 0);
  const maxH = Math.log2(values.length);
  return Math.round((h / maxH) * 1000) / 1000;
}

export function genresEligibleForFloor(userVector: UserGenreVector): RootGenre[] {
  return (Object.entries(userVector) as [RootGenre, number][])
    .filter(([g, v]) => g !== "christmas" && g !== "unknown" && (v ?? 0) >= GENRE_LIBRARY_FLOOR)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);
}

export function minSlotsForGenre(userShare: number, playlistLength: number): number {
  if (userShare < GENRE_LIBRARY_FLOOR) return 0;
  return Math.max(1, Math.ceil(playlistLength * Math.min(userShare * 0.65, 0.12)));
}

/** Reduce weight of genres that dominate recent session playlists */
export function sessionGenreDecayPenalty(
  genre: RootGenre,
  recentDominantGenres: RootGenre[],
  repeatCount: number
): number {
  if (repeatCount < 2) return 0;
  const rank = recentDominantGenres.indexOf(genre);
  if (rank < 0) return -0.04 * Math.min(repeatCount, 4);
  if (rank === 0) return 0.12 * Math.min(repeatCount, 5);
  if (rank <= 2) return 0.06 * Math.min(repeatCount, 4);
  return 0;
}

export function antiGenericCollapsePenalty(genre: RootGenre, diversityScore: number): number {
  if (diversityScore > 0.55) return 0;
  if (GENERIC_COLLAPSE_GENRES.includes(genre)) return 0.08;
  return -0.05;
}

export function ensureMinDistinctGenres<T extends { trackId: string; score: number }>(
  tracks: T[],
  pool: T[],
  classifications: Map<string, TrackGenreClassification>,
  userVector: UserGenreVector,
  minDistinct: number
): { tracks: T[]; enforced: string[] } {
  const enforced: string[] = [];
  let result = [...tracks];
  const used = new Set(result.map((t) => t.trackId));

  const libraryGenres = genresEligibleForFloor(userVector);
  const targetDistinct = Math.min(minDistinct, libraryGenres.length);
  if (targetDistinct <= 1) return { tracks: result, enforced };

  while (countDistinctGenres(result.map((t) => t.trackId), classifications) < targetDistinct) {
    const present = new Set(
      result.map((t) => classifications.get(t.trackId)?.genreFamily).filter(Boolean)
    );
    const missing = libraryGenres.find((g) => !present.has(g));
    if (!missing) break;

    const candidate = pool
      .filter((t) => !used.has(t.trackId) && classifications.get(t.trackId)?.genreFamily === missing)
      .sort((a, b) => b.score - a.score)[0];
    if (!candidate) break;

    const replaceIdx = result.reduce(
      (worst, t, i) => {
        const f = classifications.get(t.trackId)?.genreFamily ?? "unknown";
        const share = userVector[f as RootGenre] ?? 0;
        const isGeneric = GENERIC_COLLAPSE_GENRES.includes(f as RootGenre);
        const penalty = share + (isGeneric ? 0.15 : 0);
        if (penalty > worst.penalty) return { idx: i, penalty };
        return worst;
      },
      { idx: result.length - 1, penalty: -1 }
    ).idx;

    if (replaceIdx < 0) break;
    used.delete(result[replaceIdx]!.trackId);
    result[replaceIdx] = candidate;
    used.add(candidate.trackId);
    enforced.push(missing);
  }

  return { tracks: result, enforced };
}
