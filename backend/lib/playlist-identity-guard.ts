/**
 * Playlist identity protection — block recovery/fallback that betrays the prompt.
 */

import type { LockedIntent } from "../core/v3/intent";
import type { CuratorIdentity } from "./curator-identity";
import { scoreTrackForIdentity } from "./curator-identity";
import {
  scoreActivityCandidateFit,
  resolveActivityProfile,
  type ActivityClassificationInput,
  type ActivityTrackInput,
} from "./activity-profiles";
import { trackHasEraEvidence, trackHasKnownEraMismatch } from "./era-evidence";

function trackMatchesGenreFamilies(
  track: IdentityGuardTrack,
  classification: ActivityClassificationInput,
  families: string[],
): boolean {
  if (families.length === 0) return true;
  const normalized = new Set(families.map((f) => f.toLowerCase().replace(/\s+/g, "_")));
  const candidates = [
    classification?.genreFamily,
    classification?.genrePrimary,
    classification?.primarySubgenre,
    classification?.secondarySubgenre,
    ...(classification?.subGenres ?? []),
  ].filter((v): v is string => !!v).map((v) => v.toLowerCase().replace(/\s+/g, "_"));
  return candidates.some((g) => normalized.has(g));
}

export type IdentityGuardTrack = {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  energy?: number | null;
  valence?: number | null;
  tempo?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  speechiness?: number | null;
  releaseYear?: number | null;
  popularity?: number | null;
  score?: number;
};

export type PlaylistIdentityVerdict = {
  passed: boolean;
  score: number;
  identityMatch: number;
  activityMatch: number;
  genreEvidenceRatio: number;
  eraEvidenceRatio: number;
  failures: string[];
};

function classifyFor(
  trackId: string,
  classMap: Map<string, {
    genrePrimary: string;
    genreFamily: string;
    primarySubgenre: string;
    secondarySubgenre: string | null;
    subGenres: string[];
  }>,
): ActivityClassificationInput {
  return classMap.get(trackId) ?? null;
}

export function evaluatePlaylistIdentity(
  tracks: IdentityGuardTrack[],
  opts: {
    vibe: string;
    lockedIntent: LockedIntent;
    curatorIdentity: CuratorIdentity;
    classMap: Map<string, {
      genrePrimary: string;
      genreFamily: string;
      primarySubgenre: string;
      secondarySubgenre: string | null;
      subGenres: string[];
    }>;
    minPassScore?: number;
  },
): PlaylistIdentityVerdict {
  if (tracks.length === 0) {
    return {
      passed: false,
      score: 0,
      identityMatch: 0,
      activityMatch: 0,
      genreEvidenceRatio: 0,
      eraEvidenceRatio: 0,
      failures: ["empty_playlist"],
    };
  }

  const expectedFamilies = opts.lockedIntent.genreFamilies.length > 0
    ? opts.lockedIntent.genreFamilies
    : (opts.lockedIntent.primaryGenre ? [opts.lockedIntent.primaryGenre] : []);
  const eraRange = opts.lockedIntent.eraRange;
  const activityProfile = resolveActivityProfile(opts.vibe, opts.lockedIntent);

  let genreHits = 0;
  let eraHits = 0;
  let eraKnown = 0;
  let activitySum = 0;
  let identitySum = 0;

  for (const track of tracks) {
    const classification = classifyFor(track.trackId, opts.classMap);
    if (expectedFamilies.length > 0) {
      if (trackMatchesGenreFamilies(track, classification, expectedFamilies)) {
        genreHits += 1;
      }
    } else {
      genreHits += 1;
    }
    if (eraRange) {
      if (trackHasEraEvidence(track, eraRange)) eraHits += 1;
      if (track.releaseYear != null || trackHasEraEvidence(track, eraRange) || trackHasKnownEraMismatch(track, eraRange)) {
        eraKnown += 1;
      }
    }
    identitySum += scoreTrackForIdentity(track, opts.curatorIdentity);
    if (activityProfile) {
      activitySum += scoreActivityCandidateFit(
        track as ActivityTrackInput,
        classification,
        activityProfile,
        opts.vibe,
      );
    } else {
      activitySum += 0.5;
    }
  }

  const n = tracks.length;
  const genreEvidenceRatio = expectedFamilies.length > 0 ? genreHits / n : 1;
  const eraEvidenceRatio = eraRange
    ? (eraKnown > 0 ? eraHits / eraKnown : 0)
    : 1;
  const identityMatch = identitySum / n;
  const activityMatch = activitySum / n;

  const failures: string[] = [];
  if (expectedFamilies.length > 0 && genreEvidenceRatio < 0.28) failures.push("genre_identity_lost");
  if (eraRange && eraEvidenceRatio < 0.35) failures.push("era_identity_lost");
  if (activityProfile && activityMatch < 0.38) failures.push("activity_identity_lost");
  if (identityMatch < 0.42) failures.push("curator_identity_weak");

  const score = Math.max(0, Math.min(1,
    identityMatch * 0.32 +
    activityMatch * 0.28 +
    genreEvidenceRatio * 0.22 +
    eraEvidenceRatio * 0.18,
  ));

  const minPass = opts.minPassScore ?? 0.48;
  return {
    passed: failures.length === 0 && score >= minPass,
    score: Math.round(score * 1000) / 1000,
    identityMatch: Math.round(identityMatch * 1000) / 1000,
    activityMatch: Math.round(activityMatch * 1000) / 1000,
    genreEvidenceRatio: Math.round(genreEvidenceRatio * 1000) / 1000,
    eraEvidenceRatio: Math.round(eraEvidenceRatio * 1000) / 1000,
    failures,
  };
}

export function recoveryPreservesIdentity(
  before: PlaylistIdentityVerdict,
  after: PlaylistIdentityVerdict,
): boolean {
  if (!after.passed) return false;
  if (before.passed && after.score < before.score - 0.12) return false;
  return after.score >= 0.45;
}
