/**
 * Track → genre inference (public API). Multi-signal pipeline under the hood.
 */

import {
  detectTrackGenre as pipelineDetect,
  detectLibraryGenres,
  buildArtistGenreHistory,
  type ArtistGenreHistory,
  type GenreDetectionContext,
} from "./genre-detection-pipeline";
import type { TrackGenreProfile } from "./genre-taxonomy";
import type { RootGenre } from "./genre-taxonomy";

export type { TrackGenreProfile, ArtistGenreHistory, GenreDetectionContext };

export interface TrackGenreDetectInput {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  danceability: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  tempo?: number | null;
}

/** Spec-aligned profile fields */
export interface DetectedTrackGenre {
  primaryGenre: string;
  secondaryGenre: string | null;
  subGenres: string[];
  genreFamily: RootGenre;
  confidence: number;
  holidayBound: boolean;
  profile: TrackGenreProfile;
}

export function detectTrackGenreProfile(
  track: TrackGenreDetectInput,
  ctx: GenreDetectionContext
): DetectedTrackGenre {
  const profile = pipelineDetect(track, ctx);
  return {
    primaryGenre: profile.primary,
    secondaryGenre: profile.secondary,
    subGenres: profile.subGenres,
    genreFamily: profile.genreFamily,
    confidence: profile.confidence,
    holidayBound: profile.holidayBound,
    profile,
  };
}

export { detectLibraryGenres, buildArtistGenreHistory };
