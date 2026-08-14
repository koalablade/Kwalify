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

/** Primary evidence driving world identity — used for purity threshold alignment. */
export type WorldIdentityEvidenceTier =
  | "forbidden"
  | "anchor"
  | "legendary"
  | "anchor_track"
  | "natural_world"
  | "roster"
  | "artist_support"
  | "instrumentation_token"
  | "era_energy"
  | "weak";

export type WorldIdentityDecomposition = {
  score: number;
  evidenceTier: WorldIdentityEvidenceTier;
  instrumentationTokenHit: string | null;
};

const EVIDENCE_TIER_RANK: Record<WorldIdentityEvidenceTier, number> = {
  forbidden: 0,
  weak: 1,
  era_energy: 2,
  instrumentation_token: 3,
  artist_support: 4,
  roster: 5,
  natural_world: 6,
  anchor_track: 7,
  legendary: 8,
  anchor: 9,
};

function strongerEvidenceTier(
  current: WorldIdentityEvidenceTier,
  candidate: WorldIdentityEvidenceTier,
): WorldIdentityEvidenceTier {
  return EVIDENCE_TIER_RANK[candidate] > EVIDENCE_TIER_RANK[current] ? candidate : current;
}

function buildGenreBlob(track: WorldIdentityTrack): string {
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

/** Decompose world identity into score + evidence tier for downstream calibration. */
export function decomposeTrackWorldIdentity(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
): WorldIdentityDecomposition {
  const artist = String(track.artistName ?? "").trim();
  const title = String(track.trackName ?? "").trim();

  if (trackForbidden(profile, artist, title, track)) {
    return { score: 0, evidenceTier: "forbidden", instrumentationTokenHit: null };
  }
  if (artistForbiddenInWorld(artist, [profile.worldId])) {
    return { score: 0, evidenceTier: "forbidden", instrumentationTokenHit: null };
  }

  if (artist && artistMatchesAnchor(profile, artist)) {
    return {
      score: Math.min(1, 0.84 + sceneAnchorIdentityBonus(profile, artist)),
      evidenceTier: "anchor",
      instrumentationTokenHit: null,
    };
  }
  if (title && trackMatchesAnchor(profile, title, artist)) {
    return { score: 0.95, evidenceTier: "anchor_track", instrumentationTokenHit: null };
  }
  if (profile.legendaryTracks && title && matchesAny(profile.legendaryTracks, `${artist} ${title}`)) {
    return { score: 0.92, evidenceTier: "legendary", instrumentationTokenHit: null };
  }

  const identity = resolveArtistWorldIdentity(artist);
  if (identity?.naturalWorlds.includes(profile.worldId)) {
    return { score: 0.88, evidenceTier: "natural_world", instrumentationTokenHit: null };
  }
  if (identity?.forbiddenWorlds.includes(profile.worldId)) {
    return { score: 0, evidenceTier: "forbidden", instrumentationTokenHit: null };
  }

  if (artist) {
    const rosterFloor = rosterTierScoreFloor(artist, profile);
    if (rosterFloor != null) {
      return { score: rosterFloor, evidenceTier: "roster", instrumentationTokenHit: null };
    }
  }

  let score = 0.25;
  let evidenceTier: WorldIdentityEvidenceTier = "weak";
  let instrumentationTokenHit: string | null = null;

  if (artistSupportsWorld(artist, [profile.worldId])) {
    score = Math.max(score, 0.82);
    evidenceTier = strongerEvidenceTier(evidenceTier, "artist_support");
  }

  const genreBlob = buildGenreBlob(track);
  for (const token of profile.instrumentation) {
    const needle = token.toLowerCase();
    if (genreBlob.includes(needle)) {
      score = Math.max(score, 0.62);
      evidenceTier = strongerEvidenceTier(evidenceTier, "instrumentation_token");
      instrumentationTokenHit ??= token;
    }
  }

  const year = track.releaseYear;
  if (typeof year === "number" && Number.isFinite(year)) {
    const { min, max } = profile.preferredEras;
    if ((min == null || year >= min) && (max == null || year <= max)) {
      score = Math.max(score, 0.55);
      if (evidenceTier === "weak") evidenceTier = "era_energy";
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
      if (evidenceTier === "weak") evidenceTier = "era_energy";
    }
  }

  return {
    score: Math.min(1, Math.max(0, score)),
    evidenceTier,
    instrumentationTokenHit,
  };
}

/** Score 0.0–1.0 how strongly a track belongs to a cultural world profile. */
export function scoreTrackWorldIdentity(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
): number {
  return decomposeTrackWorldIdentity(track, profile).score;
}

export function scoreTrackCommittedWorldIdentity(
  track: WorldIdentityTrack,
  committed: CommittedWorld | null,
): number {
  if (!committed) return 0.5;
  const primaryId = committed.musicalWorldId ?? committed.id;
  const profile = culturalProfileForCommittedWorld([primaryId], primaryId);
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
  const primaryId = committed.musicalWorldId ?? committed.id;
  return culturalProfileForCommittedWorld([primaryId], primaryId);
}

export function getCulturalProfileOrFallback(worldId: string): CulturalWorldProfile | null {
  return getCulturalProfile(worldId);
}
