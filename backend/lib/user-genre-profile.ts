/**
 * User genre vector — full-library detection pipeline output.
 */

import {
  classifyTrack,
  profileToClassification,
  type RootGenre,
  type TrackGenreClassification,
  type TrackGenreProfile,
} from "./genre-taxonomy";
import { detectLibraryGenres } from "./genre-detection-pipeline";
import type { ArtistGenreHistory } from "./genre-detection-pipeline";
import { sampleTracksForProfile } from "./library-sample";
import { GENRE_PROFILE_MAX_TRACKS } from "./production-limits";

export type UserGenreVector = Partial<Record<RootGenre, number>>;

export interface UserGenreProfile {
  vector: UserGenreVector;
  dominant: RootGenre[];
  totalClassified: number;
  trackClassifications: Map<string, TrackGenreClassification>;
  genreProfiles: Map<string, TrackGenreProfile>;
  artistHistory: Map<string, ArtistGenreHistory>;
}

const DOMINANT_MIN = 0.05;

export function buildUserGenreProfile(
  tracks: {
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    spotifyArtistGenres?: unknown;
    albumGenres?: unknown;
    energy: number | null;
    valence: number | null;
    acousticness: number | null;
    danceability: number | null;
    instrumentalness?: number | null;
    speechiness?: number | null;
    tempo?: number | null;
  }[],
  vibe?: string
): UserGenreProfile {
  const working =
    tracks.length > GENRE_PROFILE_MAX_TRACKS
      ? sampleTracksForProfile(tracks, GENRE_PROFILE_MAX_TRACKS)
      : tracks;
  const { classifications, artistHistory, userVector } = detectLibraryGenres(working, vibe);

  const trackClassifications = new Map<string, TrackGenreClassification>();
  for (const [id, profile] of classifications) {
    trackClassifications.set(id, profileToClassification(profile));
  }
  for (const track of tracks) {
    if (!trackClassifications.has(track.trackId)) {
      trackClassifications.set(track.trackId, classifyTrack(track));
    }
  }

  const dominant = (Object.keys(userVector) as RootGenre[])
    .sort((a, b) => (userVector[b] ?? 0) - (userVector[a] ?? 0))
    .filter((k) => (userVector[k] ?? 0) >= DOMINANT_MIN);

  return {
    vector: userVector,
    dominant,
    totalClassified: trackClassifications.size,
    trackClassifications,
    genreProfiles: classifications,
    artistHistory,
  };
}

export function libraryFitScore(
  classification: TrackGenreClassification,
  userVector: UserGenreVector
): number {
  const primary = userVector[classification.genreFamily] ?? userVector[classification.genrePrimary] ?? 0.02;
  const secondary = classification.genreSecondary
    ? (userVector[classification.genreSecondary] ?? 0) * 0.5
    : 0;
  const conf = 0.35 + classification.confidenceScore * 0.4;
  return Math.min(1, primary * 2.2 + secondary + conf * 0.25);
}
