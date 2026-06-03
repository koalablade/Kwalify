/**
 * Genre coverage engine — pool analysis, missing-genre boost, overuse suppression.
 */

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { UserGenreVector } from "../../lib/user-genre-profile";
import { computeGenreDistribution } from "../../lib/genre-coverage-enforcement";
import { dynamicSimilarityBoost } from "../../shared/embeddings/dynamic-genre-graph";
import type { DynamicGenreGraph } from "../../shared/embeddings/dynamic-genre-graph";
import type { GenreForecast } from "./genre-forecast";
import type { SceneGenreRouting } from "../scene-intelligence/scene-genre-routing";
import type { GenreMemoryTrace } from "./genre-memory-trace";
import { memoryTraceBoost } from "./genre-memory-trace";
import { dominancePenaltyMultiplier } from "./soft-penalty";
import { ecosystemBalanceScore } from "./genre-ecosystems";
import {
  MAX_GENRE_DOMINANCE,
  GENRE_LIBRARY_FLOOR,
  computeDiversityScore,
  genresEligibleForFloor,
  sessionGenreDecayPenalty,
  antiGenericCollapsePenalty,
} from "./genre-constraints";
import { collapseRiskScore } from "./soft-penalty";
import { dominantGenresFromRecentPlaylists } from "./genre-session-decay";

export interface GenreCoverageState {
  coverageMap: Record<string, number>;
  missingGenres: RootGenre[];
  suppressedGenres: RootGenre[];
  diversityScore: number;
  collapseRiskScore: number;
  ecosystemBalance: number;
}

export function analyzePoolCoverage(
  sortedTrackIds: string[],
  classifications: Map<string, TrackGenreClassification>,
  userVector: UserGenreVector,
  playlistLength: number
): GenreCoverageState {
  const sample = sortedTrackIds.slice(0, Math.max(playlistLength * 4, 80));
  const coverageMap = computeGenreDistribution(sample, classifications);
  const diversityScore = computeDiversityScore(coverageMap);

  const missingGenres: RootGenre[] = [];
  for (const genre of genresEligibleForFloor(userVector)) {
    const inPool = coverageMap[genre] ?? 0;
    const target = Math.max(GENRE_LIBRARY_FLOOR, (userVector[genre] ?? 0) * 0.45);
    if (inPool < target * 0.65) missingGenres.push(genre);
  }

  const suppressedGenres: RootGenre[] = [];
  for (const [genre, share] of Object.entries(coverageMap) as [RootGenre, number][]) {
    if (share > MAX_GENRE_DOMINANCE * 0.85) suppressedGenres.push(genre);
  }

  return {
    coverageMap,
    missingGenres,
    suppressedGenres,
    diversityScore,
    collapseRiskScore: collapseRiskScore(coverageMap),
    ecosystemBalance: ecosystemBalanceScore(coverageMap),
  };
}

export function applyGenreCoverageEngine<T extends { trackId: string; score: number }>(
  sorted: T[],
  opts: {
    classifications: Map<string, TrackGenreClassification>;
    userVector: UserGenreVector;
    playlistLength: number;
    vibe: string;
    recentPlaylistTrackIds?: string[][];
    genreForecast?: GenreForecast;
    sceneRouting?: SceneGenreRouting;
    dynamicGraph?: DynamicGenreGraph;
    memoryTrace?: GenreMemoryTrace;
  }
): { pool: T[]; state: GenreCoverageState } {
  const ids = sorted.map((t) => t.trackId);
  let state = analyzePoolCoverage(ids, opts.classifications, opts.userVector, opts.playlistLength);

  const recentDominant = opts.recentPlaylistTrackIds?.length
    ? dominantGenresFromRecentPlaylists(opts.recentPlaylistTrackIds, opts.classifications)
    : [];
  const sessionRepeat = opts.recentPlaylistTrackIds?.length ?? 0;

  const counts: Partial<Record<RootGenre, number>> = {};
  const topSlice = Math.min(sorted.length, opts.playlistLength * 3);

  const boosted = sorted.map((t, idx) => {
    const c = opts.classifications.get(t.trackId);
    if (!c || c.genreFamily === "unknown") return { ...t, score: t.score * 0.72 };

    const fam = c.genreFamily;
    if (idx < topSlice) counts[fam] = (counts[fam] ?? 0) + 1;

    let score = t.score;

    const forecastBoost = opts.genreForecast?.requiredBoostGenres.includes(fam)
      ? 0.14
      : 0;
    if (state.missingGenres.includes(fam) || forecastBoost > 0) {
      const deficit = userShareDeficit(fam, state, opts.userVector) ?? 0.1;
      score += Math.min(0.24, deficit * 1.4 + forecastBoost);
      if (opts.dynamicGraph) {
        score += dynamicSimilarityBoost(fam, state.missingGenres, opts.dynamicGraph);
      }
    }

    const poolShare = (counts[fam] ?? 0) / Math.max(1, topSlice);
    const softMult = dominancePenaltyMultiplier(poolShare);
    score *= softMult;
    if (state.suppressedGenres.includes(fam) || poolShare > MAX_GENRE_DOMINANCE) {
      score *= 0.88;
    }
    if (opts.memoryTrace) score += memoryTraceBoost(fam, opts.memoryTrace);
    if (opts.sceneRouting) {
      const mult = opts.sceneRouting.genreMultipliers[fam];
      if (mult != null) score *= mult;
    }

    score -= sessionGenreDecayPenalty(fam, recentDominant, Math.min(sessionRepeat, 5));
    score += antiGenericCollapsePenalty(fam, state.diversityScore);

    if (/\b(country|road trip|highway|nashville|honky)\b/i.test(opts.vibe) && fam === "country") {
      score += 0.12;
    }

    return { ...t, score };
  });

  const pool = boosted.sort((a, b) => b.score - a.score);
  state = analyzePoolCoverage(
    pool.slice(0, topSlice).map((t) => t.trackId),
    opts.classifications,
    opts.userVector,
    opts.playlistLength
  );

  return { pool, state };
}

function userShareDeficit(
  genre: RootGenre,
  state: GenreCoverageState,
  userVector: UserGenreVector
): number {
  const target = userVector[genre] ?? 0;
  const current = state.coverageMap[genre] ?? 0;
  return Math.max(0, target * 0.5 - current);
}
