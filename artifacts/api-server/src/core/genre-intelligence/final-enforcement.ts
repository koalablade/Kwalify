/**

 * Post-compose genre enforcement — soft targets + ecosystem balance.

 */



import { enforcePlaylistGenreBalance } from "../../lib/genre-coverage-enforcement";

import { applyTopGenreDiversityFloor } from "../../lib/genre-identity-rules";

import { applyStackToFinalTracks } from "../../lib/genre-intelligence-stack";

import { buildGenreAudit, type GenreAudit } from "../../lib/genre-audit";

import type { UserGenreProfile } from "../../lib/user-genre-profile";

import type { GenreIntelligenceStack } from "../../lib/genre-intelligence-stack";

import type { RootGenre, TrackGenreClassification } from "../../lib/genre-taxonomy";

import {

  MIN_DISTINCT_GENRES_IN_PLAYLIST,

  ensureMinDistinctGenres,

} from "./genre-constraints";

import { HARD_GENRE_BACKSTOP } from "./soft-penalty";

import type { GenreCoverageState } from "./genre-coverage-engine";

import type { GenreForecast } from "./genre-forecast";

import {

  ecosystemBalanceScore,

  ecosystemDistribution,

  ecosystemsInLibrary,
  ecosystemOf,
} from "./genre-ecosystems";

import { computeGenreDistribution } from "../../lib/genre-coverage-enforcement";



export interface FinalGenreEnforcementInput<T extends { trackId: string }> {

  finalTracks: T[];

  sortedPool: T[];

  userGenreProfile: UserGenreProfile;

  genreStack: GenreIntelligenceStack;

  allowHoliday: boolean;

  suppressGenres: string[];

  coverageState?: GenreCoverageState;

  genreForecast?: GenreForecast;

  sceneInfluenceRatio?: number;
  stabilityDiagnostics?: import("../debug/stability-metrics").StabilityDiagnostics;
}



export interface FinalGenreEnforcementResult<T> {

  tracks: T[];

  genreAudit: GenreAudit;

}



function ensureEcosystemDiversity<T extends { trackId: string; score: number }>(

  tracks: T[],

  pool: T[],

  classifications: Map<string, TrackGenreClassification>,

  userVector: UserGenreProfile["vector"]

): { tracks: T[]; enforced: string[] } {

  const enforced: string[] = [];

  const libraryEcos = ecosystemsInLibrary(userVector);

  if (libraryEcos.length < 2) return { tracks, enforced };



  let result = [...tracks];

  const used = new Set(result.map((t) => t.trackId));

  const dist = computeGenreDistribution(

    result.map((t) => t.trackId),

    classifications

  );

  const ecoDist = ecosystemDistribution(dist);

  const represented = Object.keys(ecoDist).length;



  if (represented >= 2 && ecosystemBalanceScore(dist) >= 0.45) {

    return { tracks: result, enforced };

  }



  const missingEco = libraryEcos.find((e) => !(e in ecoDist));

  if (!missingEco) return { tracks: result, enforced };



  const candidate = pool.find((t) => {

    if (used.has(t.trackId)) return false;

    const fam = classifications.get(t.trackId)?.genreFamily;

    if (!fam) return false;

    return ecosystemOf(fam) === missingEco;

  });

  if (!candidate) return { tracks: result, enforced };



  const replaceIdx = result.length - 1;

  used.delete(result[replaceIdx]!.trackId);

  result[replaceIdx] = candidate;

  used.add(candidate.trackId);

  enforced.push(`ecosystem:${missingEco}`);



  return { tracks: result, enforced };

}



export function enforceFinalPlaylistGenres<T extends { trackId: string; score: number }>(

  input: FinalGenreEnforcementInput<T>

): FinalGenreEnforcementResult<T> {

  const genreClassMap = input.userGenreProfile.trackClassifications;



  const genreEnforced = enforcePlaylistGenreBalance(

    input.finalTracks,

    input.sortedPool,

    genreClassMap,

    input.userGenreProfile.vector,

    {

      allowHoliday: input.allowHoliday,

      maxDominance: HARD_GENRE_BACKSTOP,

      suppressGenres: input.suppressGenres as RootGenre[],

    }

  );



  let tracks = genreEnforced.tracks as T[];

  const genreAdjustments = [...genreEnforced.audit.enforcedAdjustments];



  const distinctPass = ensureMinDistinctGenres(

    tracks,

    input.sortedPool,

    genreClassMap,

    input.userGenreProfile.vector,

    MIN_DISTINCT_GENRES_IN_PLAYLIST

  );

  tracks = distinctPass.tracks;

  for (const g of distinctPass.enforced) {

    genreAdjustments.push({ genre: g, action: "min_distinct_genres", count: 1 });

  }



  const ecoPass = ensureEcosystemDiversity(

    tracks,

    input.sortedPool,

    genreClassMap,

    input.userGenreProfile.vector

  );

  tracks = ecoPass.tracks;

  for (const e of ecoPass.enforced) {

    genreAdjustments.push({ genre: e, action: "ecosystem_diversity", count: 1 });

  }



  const top3Floor = applyTopGenreDiversityFloor(

    tracks,

    input.sortedPool,

    genreClassMap,

    input.userGenreProfile.vector,

    3

  );

  tracks = top3Floor.tracks as T[];

  for (const g of top3Floor.enforced) {

    genreAdjustments.push({ genre: g, action: "top3_diversity_floor", count: 1 });

  }



  const clusterCap = applyStackToFinalTracks(tracks, input.genreStack);

  tracks = clusterCap.tracks as T[];

  if (clusterCap.clusterCapped) {

    genreAdjustments.push({

      genre: clusterCap.clusterCapped,

      action: "micro_cluster_cap",

      count: 1,

    });

  }



  const finalDistribution = computeGenreDistribution(

    tracks.map((t) => t.trackId),

    genreClassMap

  );



  const genreAudit = buildGenreAudit({

    userVector: input.userGenreProfile.vector,

    finalTrackIds: tracks.map((t) => t.trackId),

    classifications: genreClassMap as Map<string, TrackGenreClassification>,

    adjustments: genreAdjustments,

    ontologyNodeCount: input.genreStack.stats.ontologyNodes,

    ontologyTargetMet: input.genreStack.stats.ontologyTargetMet,

    coverageState: input.coverageState,

    genreForecast: input.genreForecast,

    sceneInfluenceRatio: input.sceneInfluenceRatio,

    dominantGenres: input.userGenreProfile.dominant,

    actualDistribution: finalDistribution,
    stabilityDiagnostics: input.stabilityDiagnostics,
  });



  return { tracks, genreAudit };

}


