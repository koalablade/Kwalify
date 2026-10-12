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
import { MUSICAL_FIT_IDENTITY_WEIGHT, scoreMusicalFit, worldMusicalCharacter } from "./world-musical-character";

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
  /** Needed to tell real audio features from metadata-inferred ones (musical fit). */
  trackId?: string | null;
  tempo?: number | null;
  loudness?: number | null;
};

/**
 * Identity-derived profiles: a named artist and a genre match are the same kind of evidence ("this
 * could belong"), scored like the old flat situation-world score. What separates candidates is the
 * song-level musical fit applied in decomposeTrackWorldIdentity, not artist membership.
 */
const DERIVED_EVIDENCE_SCORE = 0.66;

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
  /** 0–1 song-level fit to the world's musical character; null when it cannot be judged (no real features). */
  musicalFit?: number | null;
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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
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
  // A genre word in the name of an artist the identity map places in this world is not evidence
  // against it: "disco" in "Panic! At The Disco" scored all its 2005 emo songs 0 for pop punk.
  const naturalArtist = !!artistName && resolveArtistWorldIdentity(artistName)?.naturalWorlds.includes(profile.worldId) === true;
  const blob = naturalArtist ? trackName : `${artistName} ${trackName}`;
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
    if (profile.forbiddenGenrePatterns && matchesAny(profile.forbiddenGenrePatterns, genreBlob.toLowerCase())) return true;
    if (matchesAvoidEnergy(track.energy, profile)) return true;
  }
  return false;
}

/**
 * Decompose world identity into score + evidence tier for downstream calibration.
 *
 * Cultural/artist evidence says the song COULD belong; its own (real) audio features say how well it
 * actually sounds like the world. For identity-derived profiles a complete musical mismatch scales the score by
 * (1 − MUSICAL_FIT_IDENTITY_WEIGHT), so artist-level membership cannot override song-level evidence,
 * while a strong anchor that is only slightly off still clears every world threshold.
 */
export function decomposeTrackWorldIdentity(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
): WorldIdentityDecomposition {
  const base = decomposeTrackWorldIdentityEvidence(track, profile);
  // Curated profiles keep their calibrated scores (purity / proof gates depend on them); their
  // musical fit is applied in ranking (retrieval + V3 lanes) instead.
  if (base.evidenceTier === "forbidden" || !profile.derivedFromIdentity) return { ...base, musicalFit: null };
  const musicalFit = scoreMusicalFit(track, worldMusicalCharacter(profile.worldId));
  if (musicalFit == null) return { ...base, musicalFit: null };
  const score = base.score * (1 - MUSICAL_FIT_IDENTITY_WEIGHT * (1 - musicalFit));
  return { ...base, score: Math.min(1, Math.max(0, score)), musicalFit };
}

function decomposeTrackWorldIdentityEvidence(
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
    // Identity-derived "anchors" are the artists a world's identity profile names as evidence, not a
    // curated canon.
    if (profile.derivedFromIdentity) {
      return { score: DERIVED_EVIDENCE_SCORE, evidenceTier: "anchor", instrumentationTokenHit: null };
    }
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
  if (profile.genreEvidence?.length) {
    const evidenceBlob = `${genreBlob} ${stringList(track.albumGenres).join(" ")} ${artist}`.toLowerCase();
    if (matchesAny(profile.genreEvidence, evidenceBlob)) {
      score = Math.max(score, profile.derivedFromIdentity ? DERIVED_EVIDENCE_SCORE : 0.62);
      evidenceTier = strongerEvidenceTier(evidenceTier, "instrumentation_token");
    }
  }
  for (const token of profile.instrumentation) {
    const needle = token.toLowerCase();
    if (genreBlob.includes(needle)) {
      score = Math.max(score, 0.62);
      evidenceTier = strongerEvidenceTier(evidenceTier, "instrumentation_token");
      instrumentationTokenHit ??= token;
    }
  }

  // Derived (identity-based) profiles carry no era/energy evidence tiers: their musical character is
  // applied as a song-level fit in decomposeTrackWorldIdentity instead.
  if (profile.derivedFromIdentity) {
    return { score: Math.min(1, Math.max(0, score)), evidenceTier, instrumentationTokenHit };
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
