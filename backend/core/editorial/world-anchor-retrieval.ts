/**
 * World anchor retrieval — expand candidate pool via anchor/adjacent artist search
 * when library coverage is LOW/MEDIUM on a hard-locked world.
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import {
  extractAnchorArtistNames,
  extractAdjacentArtistNames,
  matchesAvoidArtist,
} from "./cultural-identity-profile";
import {
  scoreTrackWorldIdentity,
  type WorldIdentityTrack,
} from "./world-identity-score";
import { artistForbiddenInWorld } from "./artist-identity-map";
import type { CommittedWorld } from "../committed-world";
import { searchSpotifyTracks, type SpotifyTrack } from "../../lib/spotify";

export type WorldAnchorRetrievalInput = {
  accessToken?: string | null;
  userLibrary: WorldIdentityTrack[];
  culturalProfile: CulturalWorldProfile;
  committedWorld: CommittedWorld;
  maxCandidates?: number;
  userDislikedArtists?: Set<string>;
};

export type WorldAnchorRetrievalResult = {
  tracks: WorldIdentityTrack[];
  diagnostics: {
    libraryWorldFits: number;
    libraryAdjacent: number;
    spotifyQueries: string[];
    spotifyRawCount: number;
    spotifyFilteredCount: number;
    mergedCount: number;
  };
};

const MIN_WORLD_SCORE = 0.45;
const OPENER_WORLD_SCORE = 0.8;

function normalizeArtistKey(artist: string): string {
  return artist.toLowerCase().trim();
}

function trackPassesWorldFilter(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  worldIds: string[],
): boolean {
  const artist = String(track.artistName ?? "").trim();
  if (!artist) return false;
  if (matchesAvoidArtist(artist, profile)) return false;
  if (artistForbiddenInWorld(artist, worldIds)) return false;
  return scoreTrackWorldIdentity(track, profile) >= MIN_WORLD_SCORE;
}

function spotifyTrackToCandidate(track: SpotifyTrack): WorldIdentityTrack & { trackId: string } {
  const artistName = track.artists?.[0]?.name ?? "";
  const releaseYear = track.album?.release_date
    ? Number.parseInt(String(track.album.release_date).slice(0, 4), 10)
    : null;
  return {
    trackId: track.id,
    trackName: track.name,
    artistName,
    albumName: track.album?.name ?? "",
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : null,
    popularity: track.popularity ?? null,
    spotifyArtistGenres: null,
  };
}

/** Build Spotify search queries from cultural profile anchor + adjacent artists. */
export function buildAnchorSearchQueries(profile: CulturalWorldProfile): string[] {
  const anchors = extractAnchorArtistNames(profile);
  const adjacent = extractAdjacentArtistNames(profile);
  const queries: string[] = [];

  for (const name of anchors.slice(0, 6)) {
    queries.push(`artist:"${name}"`);
  }
  for (const name of adjacent.slice(0, 4)) {
    queries.push(`artist:"${name}"`);
  }

  return [...new Set(queries)].slice(0, 10);
}

/** Filter and rank expansion candidates — never include avoid/forbidden artists. */
export function filterWorldAnchorCandidates(
  candidates: WorldIdentityTrack[],
  profile: CulturalWorldProfile,
  worldIds: string[],
  opts?: { minScore?: number; userDislikedArtists?: Set<string> },
): WorldIdentityTrack[] {
  const minScore = opts?.minScore ?? MIN_WORLD_SCORE;
  const disliked = opts?.userDislikedArtists ?? new Set<string>();

  return candidates
    .filter((track) => {
      const artist = String(track.artistName ?? "").trim();
      if (!artist || disliked.has(normalizeArtistKey(artist))) return false;
      if (matchesAvoidArtist(artist, profile)) return false;
      if (artistForbiddenInWorld(artist, worldIds)) return false;
      return scoreTrackWorldIdentity(track, profile) >= minScore;
    })
    .sort(
      (a, b) => scoreTrackWorldIdentity(b, profile) - scoreTrackWorldIdentity(a, profile),
    );
}

/**
 * Retrieve world anchor candidates: user-library world fits first, then Spotify anchor search.
 * Ranking order: liked fitting world > library adjacent > anchor discovery.
 */
export async function retrieveWorldAnchorCandidates(
  input: WorldAnchorRetrievalInput,
): Promise<WorldAnchorRetrievalResult> {
  const {
    accessToken,
    userLibrary,
    culturalProfile,
    committedWorld,
    maxCandidates = 48,
    userDislikedArtists,
  } = input;
  const worldIds = committedWorld.worldIds ?? [committedWorld.id];
  const seen = new Set<string>();
  const merged: WorldIdentityTrack[] = [];

  const libraryWorldFits = filterWorldAnchorCandidates(
    userLibrary,
    culturalProfile,
    worldIds,
    { minScore: OPENER_WORLD_SCORE, userDislikedArtists },
  );
  for (const track of libraryWorldFits) {
    const id = String((track as { trackId?: string }).trackId ?? `${track.artistName}:${track.trackName}`);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(track);
  }

  const libraryAdjacent = filterWorldAnchorCandidates(
    userLibrary,
    culturalProfile,
    worldIds,
    { minScore: MIN_WORLD_SCORE, userDislikedArtists },
  ).filter((track) => {
    const id = String((track as { trackId?: string }).trackId ?? `${track.artistName}:${track.trackName}`);
    return !seen.has(id);
  });
  for (const track of libraryAdjacent) {
    const id = String((track as { trackId?: string }).trackId ?? `${track.artistName}:${track.trackName}`);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(track);
  }

  const queries = buildAnchorSearchQueries(culturalProfile);
  let spotifyRawCount = 0;
  let spotifyFiltered: WorldIdentityTrack[] = [];

  if (accessToken && queries.length > 0) {
    const raw = await searchSpotifyTracks(accessToken, queries, maxCandidates, {
      bestEffort: true,
      minTracks: 8,
      maxElapsedMs: 6000,
      maxRetries: 1,
      requestTimeoutMs: 4000,
    });
    spotifyRawCount = raw.length;
    spotifyFiltered = filterWorldAnchorCandidates(
      raw.map(spotifyTrackToCandidate),
      culturalProfile,
      worldIds,
      { userDislikedArtists },
    );
    for (const track of spotifyFiltered) {
      const id = String((track as { trackId?: string }).trackId ?? `${track.artistName}:${track.trackName}`);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(track);
    }
  }

  return {
    tracks: merged.slice(0, maxCandidates),
    diagnostics: {
      libraryWorldFits: libraryWorldFits.length,
      libraryAdjacent: libraryAdjacent.length,
      spotifyQueries: queries,
      spotifyRawCount,
      spotifyFilteredCount: spotifyFiltered.length,
      mergedCount: merged.length,
    },
  };
}
