/**

 * Pool-stage bias — sort-key adjustments before playlist composition.

 */



import type { EmotionProfile, VibeKind } from "../../lib/emotion";

import { passesSunnyGate } from "../../lib/emotion";

import {

  shouldUseGenreFallback,

  genreFallbackScore,

  pickFallbackGenres,

} from "../../lib/anti-generic-fallback";

import { classifyTrack } from "../../lib/genre-taxonomy";

import type { UserGenreProfile } from "../../lib/user-genre-profile";

import type { GenreIntelligenceStack } from "../../lib/genre-intelligence-stack";

import { applyStackToScoredPool } from "../../lib/genre-intelligence-stack";

import { applyGenreCoverageEngine } from "../genre-intelligence/genre-coverage-engine";

import type { ScoredLibraryTrack } from "./types";



export function applySunnyGateIfNeeded<T extends {

  valence: number | null;

  energy: number | null;

  acousticness: number | null;

}>(

  tracks: ScoredLibraryTrack<T>[],

  vibeKind: VibeKind,

  minLength: number

): ScoredLibraryTrack<T>[] {

  if (vibeKind !== "sunny") return tracks;



  const gated = tracks.filter((s) =>

    passesSunnyGate({

      valence: s.valence,

      energy: s.energy,

      acousticness: s.acousticness,

    })

  );

  if (gated.length >= Math.min(minLength * 2, tracks.length * 0.15)) {

    return gated;

  }

  return tracks;

}



export function sortByScore<T extends { score: number }>(tracks: T[]): T[] {

  return [...tracks].sort((a, b) => b.score - a.score);

}



export function applyGenrePoolBias<T extends {

  trackId: string;

  score: number;

  trackName?: string;

  artistName?: string;

  albumName?: string;

  energy?: number | null;

  valence?: number | null;

  acousticness?: number | null;

  danceability?: number | null;

}>(

  sorted: T[],

  opts: {

    userGenreProfile: UserGenreProfile;

    emotionProfile: EmotionProfile;

    vibe: string;

    playlistLength: number;

    genreStack: GenreIntelligenceStack;

    recentPlaylistTrackIds?: string[][];
    genreForecast?: import("../genre-intelligence/genre-forecast").GenreForecast;
    sceneRouting?: import("../scene-intelligence/scene-genre-routing").SceneGenreRouting;
    dynamicGraph?: import("../../shared/embeddings/dynamic-genre-graph").DynamicGenreGraph;
    memoryTrace?: import("../genre-intelligence/genre-memory-trace").GenreMemoryTrace;
  }
): { pool: T[]; coverageState: ReturnType<typeof applyGenreCoverageEngine>["state"] } {

  let pool = sorted;



  if (shouldUseGenreFallback(pool.length, Math.max(opts.playlistLength * 2, 40))) {

    const fallbackGenres = pickFallbackGenres(opts.userGenreProfile, opts.emotionProfile, opts.vibe);

    pool = pool

      .map((t) => {

        const c =

          opts.userGenreProfile.trackClassifications.get(t.trackId) ??

          classifyTrack({

            trackName: t.trackName ?? "",

            artistName: t.artistName ?? "",

            albumName: t.albumName ?? "",

            energy: t.energy ?? null,

            valence: t.valence ?? null,

            acousticness: t.acousticness ?? null,

            danceability: t.danceability ?? null,

          });

        return {

          ...t,

          score: t.score + genreFallbackScore(c, fallbackGenres, opts.emotionProfile) * 0.35,

        };

      })

      .sort((a, b) => b.score - a.score);

  }



  const { pool: covered, state } = applyGenreCoverageEngine(pool, {

    classifications: opts.userGenreProfile.trackClassifications,

    userVector: opts.userGenreProfile.vector,

    playlistLength: opts.playlistLength,

    vibe: opts.vibe,

    recentPlaylistTrackIds: opts.recentPlaylistTrackIds,
    genreForecast: opts.genreForecast,
    sceneRouting: opts.sceneRouting,
    dynamicGraph: opts.dynamicGraph,
    memoryTrace: opts.memoryTrace,
  });



  return {

    pool: applyStackToScoredPool(covered, opts.genreStack),

    coverageState: state,

  };

}


