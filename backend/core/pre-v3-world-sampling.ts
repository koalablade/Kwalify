/**
 * World-aware pre-V3 sampling — prevents musical hard-lock worlds from being
 * starved by strict intent-contract text-evidence filters (e.g. 300 → 17).
 */
import {
  hasExplicitMusicalHardLock,
  resolveCommittedWorld,
  type CommittedWorld,
} from "./committed-world";
import { culturalProfileForCommittedWorld } from "./editorial/cultural-identity-profile";
import { trackBelongsForWorldRetrieval } from "./editorial/world-belonging-retrieval";
import { passesWorldIdentity, worldIdentityProfilesForLock } from "./editorial/world-identity-gate";
import type { UserGenreProfile } from "../lib/user-genre-profile";
import type { LockedIntent } from "./v3/intent";
import type { WorldBoundary } from "./world-boundary";

export type PreV3WorldSamplingDiagnostics = {
  applied: boolean;
  reason: string;
  committedWorldId: string | null;
  beforeCount: number;
  afterCount: number;
  worldQualifiedFromRetrieval: number;
  worldQualifiedFromLibrary: number;
  minTarget: number;
  maxTarget: number;
  contractEvidenceCount: number;
  retrievalPoolCount: number;
};

type IdentityTrack = {
  trackName: string | null;
  artistName: string | null;
  albumName: string | null;
  genrePrimary: string | null;
  genreFamily: string | null;
  genres: string[] | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  instrumentalness?: number | null;
  popularity?: number | null;
  releaseYear?: number | null;
};

function toIdentityTrack<T extends {
  trackId: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  instrumentalness?: number | null;
  popularity?: number | null;
  releaseYear?: number | null;
  spotifyArtistGenres?: unknown;
  albumGenres?: unknown;
  genrePrimary?: string | null;
}>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  enrich?: (track: T) => T,
): IdentityTrack {
  const enriched = enrich ? enrich(track) : track;
  const classification = classMap.get(track.trackId);
  return {
    trackName: enriched.trackName ?? null,
    artistName: enriched.artistName ?? null,
    albumName: enriched.albumName ?? null,
    genrePrimary: classification?.genrePrimary ?? enriched.genrePrimary ?? null,
    genreFamily: classification?.genreFamily ?? null,
    genres: classification?.subGenres ?? null,
    spotifyArtistGenres: (enriched as { spotifyArtistGenres?: unknown }).spotifyArtistGenres,
    albumGenres: (enriched as { albumGenres?: unknown }).albumGenres,
    energy: enriched.energy ?? null,
    valence: enriched.valence ?? null,
    danceability: enriched.danceability ?? null,
    instrumentalness: enriched.instrumentalness ?? null,
    popularity: enriched.popularity ?? null,
    releaseYear: enriched.releaseYear ?? null,
  };
}

function trackQualifiesForMusicalWorld<T extends { trackId: string }>(
  track: T,
  classMap: UserGenreProfile["trackClassifications"],
  committed: CommittedWorld,
  worldBoundary: WorldBoundary,
  prompt: string,
  enrich?: (track: T) => T,
): boolean {
  const identity = toIdentityTrack(track, classMap, enrich);
  const profiles = worldIdentityProfilesForLock({
    reason: worldBoundary.reason,
    anchors: worldBoundary.lockAnchors.length > 0
      ? worldBoundary.lockAnchors
      : [committed.musicalWorldId ?? committed.id],
    prompt,
  });
  if (profiles.length > 0 && passesWorldIdentity(identity, profiles, { hardLock: true })) {
    return true;
  }
  const worldId = committed.musicalWorldId ?? committed.id;
  const profile = culturalProfileForCommittedWorld([worldId], worldId);
  if (profile && trackBelongsForWorldRetrieval(identity, profile)) {
    return true;
  }
  return false;
}

export function applyMusicalWorldPreV3Sampling<
  T extends {
    trackId: string;
    trackName?: string | null;
    artistName?: string | null;
    albumName?: string | null;
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    score?: number;
    rediscoveryScore?: number;
  },
>(opts: {
  prompt: string;
  lockedIntent?: LockedIntent | null;
  currentPool: T[];
  retrievalPool: T[];
  libraryPool: T[];
  classMap: UserGenreProfile["trackClassifications"];
  worldBoundary: WorldBoundary;
  minTarget: number;
  maxTarget: number;
  contractEvidenceCount: number;
  enrich?: (track: T) => T;
}): { pool: T[]; diagnostics: PreV3WorldSamplingDiagnostics } {
  const committed = resolveCommittedWorld({
    prompt: opts.prompt,
    lockedIntent: opts.lockedIntent ?? undefined,
  });
  const baseDiagnostics: PreV3WorldSamplingDiagnostics = {
    applied: false,
    reason: "not_musical_hard_lock",
    committedWorldId: committed?.musicalWorldId ?? committed?.id ?? null,
    beforeCount: opts.currentPool.length,
    afterCount: opts.currentPool.length,
    worldQualifiedFromRetrieval: 0,
    worldQualifiedFromLibrary: 0,
    minTarget: opts.minTarget,
    maxTarget: opts.maxTarget,
    contractEvidenceCount: opts.contractEvidenceCount,
    retrievalPoolCount: opts.retrievalPool.length,
  };

  if (!committed || !hasExplicitMusicalHardLock(committed)) {
    return { pool: opts.currentPool, diagnostics: baseDiagnostics };
  }
  if (opts.currentPool.length >= opts.minTarget) {
    return {
      pool: opts.currentPool,
      diagnostics: { ...baseDiagnostics, reason: "pool_already_sufficient" },
    };
  }

  const scoredById = new Map<string, T>();
  for (const track of opts.currentPool) scoredById.set(track.trackId, track);
  for (const track of opts.retrievalPool) {
    if (!scoredById.has(track.trackId)) scoredById.set(track.trackId, track);
  }

  const worldQualified: T[] = [];
  let fromRetrieval = 0;
  let fromLibrary = 0;
  const seen = new Set<string>();

  const consider = (track: T, source: "retrieval" | "library") => {
    if (seen.has(track.trackId)) return;
    if (!trackQualifiesForMusicalWorld(track, opts.classMap, committed, opts.worldBoundary, opts.prompt, opts.enrich)) {
      return;
    }
    seen.add(track.trackId);
    worldQualified.push({
      ...track,
      score: track.score ?? (source === "retrieval" ? 0.72 : 0.58),
    });
    if (source === "retrieval") fromRetrieval += 1;
    else fromLibrary += 1;
  };

  for (const track of opts.retrievalPool) consider(track, "retrieval");
  for (const track of opts.libraryPool) {
    if (worldQualified.length >= opts.maxTarget) break;
    consider(track, "library");
  }

  worldQualified.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const target = Math.min(opts.maxTarget, Math.max(opts.minTarget, worldQualified.length));
  const merged: T[] = [];
  const mergedIds = new Set<string>();

  for (const track of worldQualified.slice(0, target)) {
    merged.push(track);
    mergedIds.add(track.trackId);
  }
  for (const track of opts.currentPool) {
    if (mergedIds.has(track.trackId)) continue;
    merged.push(track);
    mergedIds.add(track.trackId);
  }

  const afterCount = merged.length;
  return {
    pool: merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    diagnostics: {
      applied: afterCount > opts.currentPool.length,
      reason: afterCount > opts.currentPool.length
        ? "world_qualified_fan_out"
        : worldQualified.length === 0
          ? "no_world_qualified_candidates"
          : "insufficient_world_qualified_supply",
      committedWorldId: committed.musicalWorldId ?? committed.id,
      beforeCount: opts.currentPool.length,
      afterCount,
      worldQualifiedFromRetrieval: fromRetrieval,
      worldQualifiedFromLibrary: fromLibrary,
      minTarget: opts.minTarget,
      maxTarget: opts.maxTarget,
      contractEvidenceCount: opts.contractEvidenceCount,
      retrievalPoolCount: opts.retrievalPool.length,
    },
  };
}

export function buildPreV3SamplingAuditFunnel(diagnostics: {
  libraryCount: number;
  retrievalCount: number;
  contractEvidenceCount: number;
  preV3SampleCount: number;
  postPurityCount?: number | null;
  finalDeliveredCount?: number | null;
  worldSampling?: PreV3WorldSamplingDiagnostics | null;
}): Array<{ stage: string; count: number; note?: string }> {
  const funnel: Array<{ stage: string; count: number; note?: string }> = [
    { stage: "library", count: diagnostics.libraryCount },
    { stage: "retrieval", count: diagnostics.retrievalCount },
    { stage: "contract_evidence", count: diagnostics.contractEvidenceCount },
    { stage: "pre_v3_sample", count: diagnostics.preV3SampleCount },
  ];
  if (diagnostics.worldSampling?.applied) {
    funnel.push({
      stage: "world_qualified_fan_out",
      count: diagnostics.worldSampling.afterCount,
      note: `from ${diagnostics.worldSampling.beforeCount} via retrieval=${diagnostics.worldSampling.worldQualifiedFromRetrieval} library=${diagnostics.worldSampling.worldQualifiedFromLibrary}`,
    });
  }
  if (diagnostics.postPurityCount != null) {
    funnel.push({ stage: "post_purity", count: diagnostics.postPurityCount });
  }
  if (diagnostics.finalDeliveredCount != null) {
    funnel.push({ stage: "delivered", count: diagnostics.finalDeliveredCount });
  }
  return funnel;
}
