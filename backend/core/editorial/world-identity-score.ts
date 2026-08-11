/**
 * Cultural world identity scoring — anchor artists + forbidden lists beat Spotify genres.
 */

import type { CulturalWorldProfile } from "./cultural-identity-profile";
import {
  culturalProfileForCommittedWorld,
  getCulturalProfile,
  matchesAvoidArtist,
  matchesAvoidGenre,
  matchesAvoidEnergy,
  rosterTierScoreFloor,
} from "./cultural-identity-profile";
import { sceneAnchorIdentityBonus } from "./scene-anchor-spine";
import {
  artistForbiddenInWorld,
  artistSupportsWorld,
  resolveArtistWorldIdentity,
} from "./artist-identity-map";
import type { CommittedWorld } from "../committed-world";
import { passesWorldIdentity, worldIdentityProfilesForLock } from "./world-identity-gate";

export type WorldIdentityTrack = {
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  genreFamily?: string | null;
  genrePrimary?: string | null;
  genres?: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  instrumentalness?: number | null;
  popularity?: number | null;
  releaseYear?: number | null;
};

function matchesAny(patterns: RegExp[], text: string): boolean {
  if (!text) return false;
  return patterns.some((p) => p.test(text));
}

function artistMatchesAnchor(profile: CulturalWorldProfile, artistName: string): boolean {
  return matchesAny(profile.anchorArtists, artistName);
}

function trackMatchesAnchor(profile: CulturalWorldProfile, trackName: string, artistName: string): boolean {
  const blob = `${artistName} ${trackName}`;
  return matchesAny(profile.anchorTracks, blob);
}

function trackForbidden(profile: CulturalWorldProfile, artistName: string, trackName: string, track?: WorldIdentityTrack): boolean {
  const blob = `${artistName} ${trackName}`;
  if (artistName && matchesAvoidArtist(artistName, profile)) return true;
  if (artistName && matchesAny(profile.forbiddenArtists, artistName)) return true;
  if (blob && matchesAny(profile.forbiddenPatterns, blob)) return true;
  if (track) {
    const genreBlob = [
      track.genreFamily ?? "",
      track.genrePrimary ?? "",
      ...(Array.isArray(track.genres) ? track.genres : []),
      ...(Array.isArray(track.spotifyArtistGenres)
        ? track.spotifyArtistGenres.filter((g): g is string => typeof g === "string")
        : []),
    ].join(" ");
    if (matchesAvoidGenre(genreBlob, profile)) return true;
    if (matchesAvoidEnergy(track.energy, profile)) return true;
  }
  return false;
}

/** Score 0.0–1.0 how strongly a track belongs to a cultural world profile. */
export function scoreTrackWorldIdentity(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
): number {
  const artist = String(track.artistName ?? "").trim();
  const title = String(track.trackName ?? "").trim();

  if (trackForbidden(profile, artist, title, track)) return 0;
  if (artistForbiddenInWorld(artist, [profile.worldId])) return 0;

  if (artist && artistMatchesAnchor(profile, artist)) {
    return Math.min(1, 0.84 + sceneAnchorIdentityBonus(profile, artist));
  }
  if (title && trackMatchesAnchor(profile, title, artist)) return 0.95;
  if (profile.legendaryTracks && title && matchesAny(profile.legendaryTracks, `${artist} ${title}`)) {
    return 0.92;
  }

  const identity = resolveArtistWorldIdentity(artist);
  if (identity?.naturalWorlds.includes(profile.worldId)) return 0.88;
  if (identity?.forbiddenWorlds.includes(profile.worldId)) return 0;

  if (artist) {
    const rosterFloor = rosterTierScoreFloor(artist, profile);
    if (rosterFloor != null) return rosterFloor;
  }

  let score = 0.25;

  if (artistSupportsWorld(artist, [profile.worldId])) {
    score = Math.max(score, 0.82);
  }

  const genreBlob = [
    track.genreFamily ?? "",
    track.genrePrimary ?? "",
    ...(Array.isArray(track.genres) ? track.genres : []),
    ...(Array.isArray(track.spotifyArtistGenres)
      ? track.spotifyArtistGenres.filter((g): g is string => typeof g === "string")
      : []),
  ]
    .join(" ")
    .toLowerCase();

  for (const token of profile.instrumentation) {
    if (genreBlob.includes(token.toLowerCase())) score = Math.max(score, 0.62);
  }

  const year = track.releaseYear;
  if (typeof year === "number" && Number.isFinite(year)) {
    const { min, max } = profile.preferredEras;
    if ((min == null || year >= min) && (max == null || year <= max)) {
      score = Math.max(score, 0.55);
    } else if ((min != null && year < min - 8) || (max != null && year > max + 8)) {
      score *= 0.75;
    }
  }

  const energy = track.energy;
  if (typeof energy === "number" && Number.isFinite(energy)) {
    const { min, max } = profile.energyRange;
    if ((min != null && energy < min) || (max != null && energy > max)) {
      score *= 0.7;
    } else {
      score = Math.max(score, 0.58);
    }
  }

  return Math.min(1, Math.max(0, score));
}

export function scoreTrackCommittedWorldIdentity(
  track: WorldIdentityTrack,
  committed: CommittedWorld | null,
): number {
  if (!committed) return 0.5;
  const profile = culturalProfileForCommittedWorld(committed.worldIds, committed.id);
  if (!profile) {
    const profiles = worldIdentityProfilesForLock({
      prompt: committed.reason,
      anchors: committed.worldIds,
      reason: committed.reason,
    });
    if (!passesWorldIdentity(track, profiles, { hardLock: true })) return 0;
    return 0.65;
  }
  return scoreTrackWorldIdentity(track, profile);
}

export function isAnchorArtistForProfile(
  artistName: string | null | undefined,
  profile: CulturalWorldProfile,
): boolean {
  const artist = String(artistName ?? "").trim();
  if (!artist) return false;
  return artistMatchesAnchor(profile, artist);
}

export function resolveCulturalProfileForCommitted(committed: CommittedWorld | null): CulturalWorldProfile | null {
  if (!committed) return null;
  return culturalProfileForCommittedWorld(committed.worldIds, committed.id);
}

export function getCulturalProfileOrFallback(worldId: string): CulturalWorldProfile | null {
  return getCulturalProfile(worldId);
}
