/**
 * World belonging for retrieval — "imperfect but belongs" admission.
 * Keeps culturally adjacent tracks in the candidate pool; purity gates decide later.
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import {
  extractAcceptableAdjacencyNames,
  extractAdjacentArtistNames,
  extractCultArtistNames,
  extractDeepCutNames,
  extractEraExtensionNames,
  extractForgottenArtistNames,
  extractMajorArtistNames,
  matchesAdjacentArtist,
  matchesAcceptableAdjacency,
} from "./cultural-identity-profile";
import { scoreTrackWorldIdentity, type WorldIdentityTrack } from "./world-identity-score";
import {
  atmosphericLexicalHackPenalty,
  resolveAtmosphericContext,
  scoreAtmosphericContextFit,
} from "./atmospheric-context-scoring";

/** Below gate thresholds — retrieval only. Gates still apply at 80/85/90/95. */
export const WORLD_BELONGING_RETRIEVAL_MIN = 0.35;

function normalizeArtist(artist: string): string {
  return artist
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function artistMatchesNameList(artist: string, names: string[]): boolean {
  const normalized = normalizeArtist(artist);
  if (!normalized) return false;
  return names.some((name) => {
    const needle = normalizeArtist(name);
    return needle.length > 0 && (normalized.includes(needle) || needle.includes(normalized));
  });
}

/** Profile roster beyond anchors — major, deep cuts, cult, era neighbours a human DJ would accept. */
export function artistOnWorldRoster(artistName: string, profile: CulturalWorldProfile): boolean {
  const artist = String(artistName ?? "").trim();
  if (!artist) return false;
  if (matchesAdjacentArtist(artist, profile)) return true;
  if (matchesAcceptableAdjacency(artist, profile)) return true;
  return artistMatchesNameList(artist, [
    ...extractMajorArtistNames(profile),
    ...extractDeepCutNames(profile),
    ...extractForgottenArtistNames(profile),
    ...extractCultArtistNames(profile),
    ...extractEraExtensionNames(profile),
    ...extractAdjacentArtistNames(profile),
    ...extractAcceptableAdjacencyNames(profile),
  ]);
}

function instrumentationBlob(track: WorldIdentityTrack): string {
  return [
    track.genreFamily ?? "",
    track.genrePrimary ?? "",
    ...(Array.isArray(track.genres) ? track.genres : []),
    ...(Array.isArray(track.spotifyArtistGenres)
      ? track.spotifyArtistGenres.filter((g): g is string => typeof g === "string")
      : []),
  ]
    .join(" ")
    .toLowerCase();
}

export function trackMatchesWorldInstrumentation(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
): boolean {
  const blob = instrumentationBlob(track);
  if (!blob.trim()) return false;
  return profile.instrumentation.some((token) => blob.includes(token.toLowerCase()));
}

/**
 * Retrieval admission: imperfect but belongs in this cultural world.
 * Uses existing world-identity scoring — does not change score function or gate thresholds.
 */
export function trackBelongsForWorldRetrieval(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
): boolean {
  if (artistOnWorldRoster(track.artistName ?? "", profile)) return true;
  if (trackMatchesWorldInstrumentation(track, profile)) return true;
  return scoreTrackWorldIdentity(track, profile) >= WORLD_BELONGING_RETRIEVAL_MIN;
}

export function scoreWorldBelongingRank(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
): number {
  const identity = scoreTrackWorldIdentity(track, profile);
  let boost = 0;
  if (artistOnWorldRoster(track.artistName ?? "", profile)) boost += 0.12;
  if (trackMatchesWorldInstrumentation(track, profile)) boost += 0.06;
  const context = resolveAtmosphericContext(profile.worldId);
  if (context) {
    const atmosphericTrack = {
      trackName: track.trackName,
      artistName: track.artistName,
      energy: track.energy ?? null,
      valence: track.valence ?? null,
      danceability: track.danceability ?? null,
      acousticness: (track as { acousticness?: number | null }).acousticness ?? null,
      instrumentalness: track.instrumentalness ?? null,
      speechiness: (track as { speechiness?: number | null }).speechiness ?? null,
      genreFamily: track.genreFamily ?? null,
      genrePrimary: track.genrePrimary ?? null,
    };
    const fit = scoreAtmosphericContextFit(atmosphericTrack, context);
    const hack = atmosphericLexicalHackPenalty(atmosphericTrack, context);
    boost += fit * 0.14 - hack * 0.35;
  }
  return Math.min(1, identity + boost);
}
