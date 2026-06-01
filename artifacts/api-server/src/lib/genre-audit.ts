/**

 * Genre audit output for API + debugging.

 */



import type { RootGenre } from "./genre-taxonomy";

import type { TrackGenreClassification } from "./genre-taxonomy";

import type { UserGenreVector } from "./user-genre-profile";

import {

  computeGenreDistribution,

  detectMissingGenres,

  vectorToRecord,

  activeCoverageTargets,

} from "./genre-coverage-enforcement";

import { GENRE_MIN_LIBRARY_SHARE } from "./genre-coverage";

import type { GenreCoverageState } from "../core/genre-intelligence/genre-coverage-engine";

import type { GenreForecast } from "../core/genre-intelligence/genre-forecast";

import { computeDiversityScore } from "../core/genre-intelligence/genre-constraints";

import { ecosystemBalanceScore } from "../core/genre-intelligence/genre-ecosystems";
import type { StabilityDiagnostics } from "../core/debug/stability-metrics";



export interface GenreDiagnostics {

  coverageMap: Record<string, number>;

  missingGenres: string[];

  dominantGenres: string[];

  diversityScore: number;

  sceneInfluenceRatio: number;

  predictedDistribution: Record<string, number>;

  actualDistribution: Record<string, number>;

  collapseRiskScore: number;

  ecosystemBalance: number;

  preScoreAdjustments: { genre: string; boost: number; reason: string }[];
  stabilityScore?: number;
  conflictReports?: StabilityDiagnostics["conflictReports"];
  layerContributionSummary?: Record<string, number>;
  truthAnchorDriftScore?: number;
  deterministicMode?: boolean;
}



export interface GenreAudit {

  detectedGenres: string[];

  missingGenres: string[];

  distribution: Record<string, number>;

  userDistribution: Record<string, number>;

  adjustmentsApplied: string[];

  /** @deprecated use adjustmentsApplied */

  enforcedAdjustments?: { genre: string; action: string; count: number }[];

  finalDistribution: Record<string, number>;

  coverageTargets: { genre: string; min: number; max: number; userShare: number }[];

  ontologyNodeCount?: number;

  ontologyTargetMet?: boolean;

  genreDiagnostics?: GenreDiagnostics;

}



export function buildGenreAudit(opts: {

  userVector: UserGenreVector;

  finalTrackIds: string[];

  classifications: Map<string, TrackGenreClassification>;

  adjustments: { genre: string; action: string; count?: number }[];

  ontologyNodeCount?: number;

  ontologyTargetMet?: boolean;

  coverageState?: GenreCoverageState;

  genreForecast?: GenreForecast;

  sceneInfluenceRatio?: number;

  dominantGenres?: string[];

  actualDistribution?: Record<string, number>;
  stabilityDiagnostics?: StabilityDiagnostics;
}): GenreAudit {

  const userDistribution = vectorToRecord(opts.userVector);

  const finalDistribution =

    opts.actualDistribution ??

    computeGenreDistribution(opts.finalTrackIds, opts.classifications);

  const missingGenres = detectMissingGenres(opts.userVector, finalDistribution);



  const detectedGenres = Object.entries(userDistribution)

    .filter(([, v]) => v >= GENRE_MIN_LIBRARY_SHARE)

    .sort((a, b) => b[1] - a[1])

    .map(([g]) => g);



  const adjustmentsApplied = opts.adjustments.map(

    (a) => `${a.action}:${a.genre}${a.count != null ? `(${a.count})` : ""}`

  );



  const predictedDistribution = opts.genreForecast?.predictedDistribution ?? userDistribution;

  const collapseRiskScore =

    opts.genreForecast?.collapseRiskScore ?? opts.coverageState?.collapseRiskScore ?? 0;

  const ecosystemBalance =

    opts.coverageState?.ecosystemBalance ?? ecosystemBalanceScore(finalDistribution);



  return {

    detectedGenres,

    missingGenres,

    distribution: finalDistribution,

    userDistribution,

    adjustmentsApplied,

    enforcedAdjustments: opts.adjustments.map((a) => ({

      genre: a.genre,

      action: a.action,

      count: a.count ?? 1,

    })),

    finalDistribution,

    coverageTargets: activeCoverageTargets(opts.userVector, ["christmas"]).map((t) => ({

      genre: t.genre,

      min: t.min,

      max: t.max,

      userShare: t.userShare,

    })),

    ontologyNodeCount: opts.ontologyNodeCount,

    ontologyTargetMet: opts.ontologyTargetMet,

    genreDiagnostics: {

      coverageMap: opts.coverageState?.coverageMap ?? finalDistribution,

      missingGenres: opts.coverageState?.missingGenres?.length

        ? opts.coverageState.missingGenres

        : missingGenres,

      dominantGenres: opts.dominantGenres ?? detectedGenres.slice(0, 5),

      diversityScore:

        opts.coverageState?.diversityScore ?? computeDiversityScore(finalDistribution),

      sceneInfluenceRatio: opts.sceneInfluenceRatio ?? 0.28,

      predictedDistribution,

      actualDistribution: finalDistribution,

      collapseRiskScore,

      ecosystemBalance,

      preScoreAdjustments: (opts.genreForecast?.preScoreAdjustments ?? []).map((a) => ({
        genre: a.genre,
        boost: a.boost,
        reason: a.reason,
      })),
      stabilityScore: opts.stabilityDiagnostics?.playlistStabilityScore,
      conflictReports: opts.stabilityDiagnostics?.conflictReports,
      layerContributionSummary: opts.stabilityDiagnostics?.layerContributionSummary,
      truthAnchorDriftScore: opts.stabilityDiagnostics?.truthAnchorDriftScore,
      deterministicMode: opts.stabilityDiagnostics?.deterministicMode,
    },
  };
}


