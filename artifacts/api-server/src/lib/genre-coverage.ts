/**
 * Genre coverage — minimum presence per playlist for listener realism.
 */

import type { RootGenre } from "./genre-taxonomy";
import type { TrackGenreClassification } from "./genre-taxonomy";
import type { UserGenreVector } from "./user-genre-profile";

export interface GenreCoverageBand {
  min: number;
  max: number;
}

/** If genre is ≥ this share in user library, playlist must include at least min band */
export const GENRE_MIN_LIBRARY_SHARE = 0.03;

/** No single genre family may exceed this share in a playlist (hard constraint) */
export const GENRE_MAX_DOMINANCE = 0.35;

/** Target share of playlist slots (0–1) when genre exists in user library */
export const GENRE_COVERAGE: Partial<Record<RootGenre, GenreCoverageBand>> = {
  country: { min: 0.05, max: 0.3 },
  hip_hop: { min: 0.1, max: 0.35 },
  rock: { min: 0.1, max: 0.4 },
  electronic: { min: 0.05, max: 0.3 },
  jazz: { min: 0.03, max: 0.15 },
  pop: { min: 0.08, max: 0.4 },
  folk: { min: 0.05, max: 0.22 },
  soul: { min: 0.05, max: 0.2 },
  indie: { min: 0.06, max: 0.28 },
  metal: { min: 0.04, max: 0.25 },
  blues: { min: 0.03, max: 0.15 },
  rnb: { min: 0.05, max: 0.25 },
  reggae: { min: 0.03, max: 0.12 },
  latin: { min: 0.04, max: 0.2 },
  soundtrack: { min: 0.02, max: 0.12 },
  world: { min: 0.03, max: 0.15 },
  classical: { min: 0.02, max: 0.1 },
};

export function activeCoverageTargets(
  userVector: UserGenreVector,
  suppressGenres: RootGenre[] = []
): { genre: RootGenre; min: number; max: number; userShare: number }[] {
  const out: { genre: RootGenre; min: number; max: number; userShare: number }[] = [];

  for (const [genre, band] of Object.entries(GENRE_COVERAGE) as [RootGenre, GenreCoverageBand][]) {
    if (suppressGenres.includes(genre)) continue;
    const userShare = userVector[genre] ?? 0;
    if (userShare < 0.04) continue;
    const min = Math.max(GENRE_MIN_LIBRARY_SHARE, Math.min(band.min, userShare * 0.85));
    const max = Math.min(GENRE_MAX_DOMINANCE, Math.min(band.max, userShare * 1.4 + 0.08));
    out.push({ genre, min, max, userShare });
  }

  return out.sort((a, b) => b.userShare - a.userShare);
}

/** Boost score when genre is underrepresented in current candidate ordering */
export function coverageBoostForTrack(
  classification: TrackGenreClassification,
  targets: ReturnType<typeof activeCoverageTargets>,
  currentGenreCounts: Partial<Record<RootGenre, number>>,
  playlistLength: number
): number {
  if (playlistLength <= 0) return 0;
  const target = targets.find((t) => t.genre === classification.genrePrimary);
  if (!target) return 0;

  const current = (currentGenreCounts[classification.genrePrimary] ?? 0) / playlistLength;
  if (current >= target.min) return 0;

  const deficit = target.min - current;
  return Math.min(0.18, deficit * 1.2 * target.userShare);
}

export function applyGenreCoverageBias<T extends { trackId: string; score: number }>(
  sorted: T[],
  classifications: Map<string, TrackGenreClassification>,
  userVector: UserGenreVector,
  playlistLength: number
): T[] {
  const targets = activeCoverageTargets(userVector, ["christmas"]);
  if (targets.length === 0) return sorted;

  const counts: Partial<Record<RootGenre, number>> = {};
  const boosted = sorted.map((t) => {
    const c = classifications.get(t.trackId);
    if (!c) return t;
    const boost = coverageBoostForTrack(c, targets, counts, playlistLength);
    return { ...t, score: t.score + boost };
  });

  return boosted.sort((a, b) => b.score - a.score);
}
