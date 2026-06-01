/**
 * Genre coverage enforcement — playlist distribution ≈ user library (± tolerance).
 */

import type { RootGenre, TrackGenreClassification } from "./genre-taxonomy";
import type { TrackGenreProfile } from "./genre-taxonomy";
import type { UserGenreVector } from "./user-genre-profile";
import { activeCoverageTargets, GENRE_COVERAGE } from "./genre-coverage";

import { GENRE_MAX_DOMINANCE, GENRE_MIN_LIBRARY_SHARE } from "./genre-coverage";

export const DEFAULT_MAX_GENRE_DOMINANCE = GENRE_MAX_DOMINANCE;
export const LIBRARY_PRESENCE_THRESHOLD = GENRE_MIN_LIBRARY_SHARE;
export const DISTRIBUTION_TOLERANCE = 0.12;

export interface GenreAudit {
  detectedGenres: Record<string, number>;
  userDistribution: Record<string, number>;
  missingGenres: string[];
  enforcedAdjustments: { genre: string; action: string; count: number }[];
  finalDistribution: Record<string, number>;
  coverageTargets: { genre: string; min: number; max: number; userShare: number }[];
}

export function computeGenreDistribution(
  trackIds: string[],
  classifications: Map<string, TrackGenreClassification | TrackGenreProfile>
): Record<string, number> {
  const counts: Partial<Record<RootGenre, number>> = {};
  for (const id of trackIds) {
    const c = classifications.get(id);
    if (!c) continue;
    const fam = familyOf(c);
    if (fam === "unknown") continue;
    counts[fam] = (counts[fam] ?? 0) + 1;
  }
  const total = trackIds.length || 1;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    out[k] = Math.round((v / total) * 1000) / 1000;
  }
  return out;
}

export function vectorToRecord(vec: UserGenreVector): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(vec)) {
    if (v != null && v >= 0.01) out[k] = Math.round(v * 1000) / 1000;
  }
  return out;
}

export function detectMissingGenres(
  userVector: UserGenreVector,
  playlistDist: Record<string, number>,
  tolerance = DISTRIBUTION_TOLERANCE
): string[] {
  const missing: string[] = [];
  for (const [genre, userShare] of Object.entries(userVector) as [RootGenre, number][]) {
    if (genre === "christmas" || genre === "unknown") continue;
    if ((userShare ?? 0) < LIBRARY_PRESENCE_THRESHOLD) continue;
    const inPlaylist = playlistDist[genre] ?? 0;
    const target = activeCoverageTargets(userVector).find((t) => t.genre === genre);
    const minExpected = target?.min ?? Math.max(0.05, userShare * 0.5);
    if (inPlaylist < minExpected - tolerance) {
      missing.push(genre);
    }
  }
  return missing;
}

function classificationOf(
  map: Map<string, TrackGenreClassification | TrackGenreProfile>,
  id: string
): TrackGenreClassification | TrackGenreProfile | undefined {
  return map.get(id);
}

function familyOf(c: TrackGenreClassification | TrackGenreProfile): RootGenre {
  return "genreFamily" in c && c.genreFamily ? c.genreFamily : c.genrePrimary;
}

/** Swap tracks into final list to satisfy genre mins and dominance cap */
export function enforcePlaylistGenreBalance<T extends { trackId: string; score: number }>(
  finalTracks: T[],
  candidatePool: T[],
  classifications: Map<string, TrackGenreClassification | TrackGenreProfile>,
  userVector: UserGenreVector,
  opts: {
    allowHoliday?: boolean;
    maxDominance?: number;
    suppressGenres?: RootGenre[];
  } = {}
): { tracks: T[]; audit: GenreAudit } {
  const allowHoliday = opts.allowHoliday ?? false;
  const maxDom = opts.maxDominance ?? DEFAULT_MAX_GENRE_DOMINANCE;
  const suppress = new Set(opts.suppressGenres ?? ["christmas"]);

  const adjustments: GenreAudit["enforcedAdjustments"] = [];
  let tracks = [...finalTracks];
  const used = new Set(tracks.map((t) => t.trackId));
  const pool = candidatePool.filter((t) => !used.has(t.trackId));

  const userDist = vectorToRecord(userVector);
  const targets = activeCoverageTargets(userVector, allowHoliday ? [] : ["christmas"]);

  const trySwapIn = (genre: RootGenre): boolean => {
    let donorIdx = -1;
    let donorScore = Infinity;
    for (let i = 0; i < tracks.length; i++) {
      const c = classificationOf(classifications, tracks[i]!.trackId);
      if (!c || familyOf(c) === genre) continue;
      if (tracks[i]!.score < donorScore) {
        donorScore = tracks[i]!.score;
        donorIdx = i;
      }
    }
    if (donorIdx < 0) return false;

    const candidate = pool
      .filter((t) => {
        if (used.has(t.trackId)) return false;
        const c = classificationOf(classifications, t.trackId);
        return c && familyOf(c) === genre && !c.holidayBound;
      })
      .sort((a, b) => b.score - a.score)[0];
    if (!candidate) return false;

    used.delete(tracks[donorIdx]!.trackId);
    tracks[donorIdx] = candidate;
    used.add(candidate.trackId);
    adjustments.push({ genre, action: "swap_in_underrepresented", count: 1 });
    return true;
  };

  let missing = detectMissingGenres(userVector, computeGenreDistribution(
    tracks.map((t) => t.trackId),
    classifications
  ));

  for (const genre of missing) {
    if (suppress.has(genre as RootGenre)) continue;
    if (trySwapIn(genre as RootGenre)) {
      missing = detectMissingGenres(
        userVector,
        computeGenreDistribution(
          tracks.map((t) => t.trackId),
          classifications
        )
      );
    }
  }

  for (const target of targets) {
    let dist = computeGenreDistribution(
      tracks.map((t) => t.trackId),
      classifications
    );
    while ((dist[target.genre] ?? 0) < target.min && pool.length > 0) {
      if (!trySwapIn(target.genre)) break;
      dist = computeGenreDistribution(
        tracks.map((t) => t.trackId),
        classifications
      );
    }
  }

  let dist = computeGenreDistribution(
    tracks.map((t) => t.trackId),
    classifications
  );
  for (const [genre, share] of Object.entries(dist)) {
    if (share > maxDom) {
      const overflow = share - maxDom;
      const rep = targets.find((t) => t.genre === genre as RootGenre);
      if (rep && overflow > 0.08) {
        adjustments.push({ genre, action: "dominance_cap_warning", count: 1 });
      }
    }
  }

  if (!allowHoliday) {
    tracks = tracks.filter((t) => {
      const c = classificationOf(classifications, t.trackId);
      if (c?.holidayBound) {
        adjustments.push({ genre: "christmas", action: "removed_holiday_from_non_seasonal", count: 1 });
        return false;
      }
      return true;
    });
    while (tracks.length < finalTracks.length && pool.length > 0) {
      const fill = pool.find((p) => !used.has(p.trackId) && !classificationOf(classifications, p.trackId)?.holidayBound);
      if (!fill) break;
      tracks.push(fill);
      used.add(fill.trackId);
    }
  }

  const finalDistribution = computeGenreDistribution(
    tracks.map((t) => t.trackId),
    classifications
  );

  const audit: GenreAudit = {
    detectedGenres: Object.keys(GENRE_COVERAGE).reduce(
      (acc, g) => {
        if ((userVector[g as RootGenre] ?? 0) >= LIBRARY_PRESENCE_THRESHOLD) acc[g] = userVector[g as RootGenre] ?? 0;
        return acc;
      },
      {} as Record<string, number>
    ),
    userDistribution: userDist,
    missingGenres: detectMissingGenres(userVector, finalDistribution),
    enforcedAdjustments: adjustments,
    finalDistribution,
    coverageTargets: targets.map((t) => ({
      genre: t.genre,
      min: t.min,
      max: t.max,
      userShare: t.userShare,
    })),
  };

  return { tracks, audit };
}

