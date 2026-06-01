/**
 * Pre-scoring genre forecast — predict collapse before ranking.
 */

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";
import type { UserGenreVector } from "../../lib/user-genre-profile";
import { computeGenreDistribution } from "../../lib/genre-coverage-enforcement";
import { genresEligibleForFloor, GENRE_LIBRARY_FLOOR } from "./genre-constraints";
import {
  collapseRiskScore,
  safeDistributionTargets,
  SOFT_GENRE_TARGET,
} from "./soft-penalty";
import { ecosystemsInLibrary, ecosystemDistribution } from "./genre-ecosystems";
import type { SceneGenreRouting } from "../scene-intelligence/scene-genre-routing";
import { useFrozenForecast } from "../debug/stability-config";

export interface GenreForecast {
  predictedDominantGenres: RootGenre[];
  riskOfCollapse: boolean;
  collapseRiskScore: number;
  requiredBoostGenres: RootGenre[];
  safeDistributionTargets: Record<string, number>;
  predictedDistribution: Record<string, number>;
  poolSkewGenres: RootGenre[];
  preScoreAdjustments: { genre: RootGenre; boost: number; reason: string }[];
}

export function buildGenreForecast(opts: {
  trackIds: string[];
  classifications: Map<string, TrackGenreClassification>;
  userVector: UserGenreVector;
  playlistLength: number;
  sceneRouting?: SceneGenreRouting;
  topCandidateCount?: number;
}): GenreForecast {
  const sampleSize = opts.topCandidateCount ?? Math.min(opts.trackIds.length, opts.playlistLength * 8);
  const sample = opts.trackIds.slice(0, sampleSize);
  const predictedDistribution = computeGenreDistribution(sample, opts.classifications);

  const predictedDominantGenres = (Object.entries(predictedDistribution) as [RootGenre, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([g]) => g);

  const collapseRisk = collapseRiskScore(predictedDistribution);
  const riskOfCollapse = collapseRisk >= 0.52;

  const eligible = genresEligibleForFloor(opts.userVector);
  const safeTargets = safeDistributionTargets(opts.userVector, opts.playlistLength, eligible);

  const requiredBoostGenres: RootGenre[] = [];
  const preScoreAdjustments: { genre: RootGenre; boost: number; reason: string }[] = [];

  for (const genre of eligible) {
    const predicted = predictedDistribution[genre] ?? 0;
    const target = safeTargets[genre] ?? GENRE_LIBRARY_FLOOR;
    const userShare = opts.userVector[genre] ?? 0;

    if (predicted < target * 0.7 && userShare >= GENRE_LIBRARY_FLOOR) {
      requiredBoostGenres.push(genre);
      const boost = Math.min(0.2, (target - predicted) * 1.1 + userShare * 0.08);
      preScoreAdjustments.push({ genre, boost, reason: "forecast_underrepresented" });
    }
  }

  if (riskOfCollapse && !useFrozenForecast()) {
    for (const g of predictedDominantGenres.slice(0, 2)) {
      if ((predictedDistribution[g] ?? 0) > SOFT_GENRE_TARGET) {
        preScoreAdjustments.push({
          genre: g,
          boost: -0.06,
          reason: "forecast_collapse_penalty",
        });
      }
    }
  }

  if (opts.sceneRouting && !useFrozenForecast()) {
    for (const g of opts.sceneRouting.boostedGenres) {
      if (!requiredBoostGenres.includes(g)) requiredBoostGenres.push(g);
      preScoreAdjustments.push({ genre: g, boost: 0.1, reason: "scene_routing_boost" });
    }
  }

  const poolSkewGenres = predictedDominantGenres.filter(
    (g) => (predictedDistribution[g] ?? 0) > SOFT_GENRE_TARGET * 1.2
  );

  const libraryEcos = ecosystemsInLibrary(opts.userVector);
  const ecoDist = ecosystemDistribution(predictedDistribution);
  if (libraryEcos.length >= 2) {
    const represented = Object.keys(ecoDist).length;
    if (represented < 2) {
      for (const g of eligible) {
        if (!requiredBoostGenres.includes(g)) {
          requiredBoostGenres.push(g);
          preScoreAdjustments.push({ genre: g, boost: 0.08, reason: "ecosystem_gap" });
        }
      }
    }
  }

  return {
    predictedDominantGenres,
    riskOfCollapse,
    collapseRiskScore: collapseRisk,
    requiredBoostGenres: [...new Set(requiredBoostGenres)],
    safeDistributionTargets: safeTargets,
    predictedDistribution,
    poolSkewGenres,
    preScoreAdjustments,
  };
}

/** Fast forecast from full library classifications (10k+ safe) */
export function buildGenreForecastFromLibrary(opts: {
  classifications: Map<string, TrackGenreClassification>;
  userVector: UserGenreVector;
  playlistLength: number;
  sceneRouting?: SceneGenreRouting;
}): GenreForecast {
  const counts: Partial<Record<RootGenre, number>> = {};
  let total = 0;
  for (const c of opts.classifications.values()) {
    if (c.genreFamily === "unknown") continue;
    counts[c.genreFamily] = (counts[c.genreFamily] ?? 0) + 1;
    total++;
  }
  const predictedDistribution: Record<string, number> = {};
  for (const [g, n] of Object.entries(counts) as [RootGenre, number][]) {
    predictedDistribution[g] = Math.round((n / Math.max(1, total)) * 1000) / 1000;
  }

  const base = buildGenreForecast({
    trackIds: [...opts.classifications.keys()].slice(0, Math.min(500, opts.playlistLength * 8)),
    classifications: opts.classifications,
    userVector: opts.userVector,
    playlistLength: opts.playlistLength,
    sceneRouting: opts.sceneRouting,
  });

  return {
    ...base,
    predictedDistribution,
    predictedDominantGenres: (Object.entries(predictedDistribution) as [RootGenre, number][])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([g]) => g),
    collapseRiskScore: collapseRiskScore(predictedDistribution),
    riskOfCollapse: collapseRiskScore(predictedDistribution) >= 0.52,
    poolSkewGenres: (Object.entries(predictedDistribution) as [RootGenre, number][])
      .filter(([, s]) => s > SOFT_GENRE_TARGET * 1.2)
      .map(([g]) => g),
  };
}

export function preScoreBoostForTrack(
  genre: RootGenre,
  forecast: GenreForecast
): number {
  let boost = 0;
  for (const adj of forecast.preScoreAdjustments) {
    if (adj.genre === genre) boost += adj.boost;
  }
  return boost;
}
