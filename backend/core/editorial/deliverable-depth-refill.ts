/**
 * V35 deliverable depth refill — ranked survivor pool refills downstream validation losses.
 * requested count → validate composed set → refill from ranked pool until count or exhaustion.
 */

import type { CommittedWorld } from "../committed-world";
import type { CulturalWorldProfile } from "./cultural-identity-profile";
import { matchesAvoidArtist } from "./cultural-identity-profile";
import { scoreTrackWorldIdentity, type WorldIdentityTrack } from "./world-identity-score";
import { trackPassesWorldPurity } from "./world-purity-gate";
import { normalizeSessionArtist } from "../../lib/session-artist-gravity";
import { driveMomentContextPenalty, isSemanticSpamTrack } from "../playlist-contract/contract-axis-scoring";
import {
  atmosphericLexicalHackPenalty,
  isAtmosphericLexicalHack,
  resolveAtmosphericContext,
  scoreAtmosphericContextFit,
} from "./atmospheric-context-scoring";

export type DeliverableDepthRefillDiagnostics = {
  seedCount: number;
  poolSize: number;
  requestedLength: number;
  outputCount: number;
  refilledCount: number;
  poolExhausted: boolean;
  positionReplacements: number;
  tailAppends: number;
};

export type DeliverableDepthRefillResult<T extends WorldIdentityTrack> = {
  tracks: T[];
  diagnostics: DeliverableDepthRefillDiagnostics;
};

export type DeliverableDepthRefillOpts<T extends WorldIdentityTrack> = {
  prompt?: string;
  requestedLength: number;
  committed: CommittedWorld | null;
  profile: CulturalWorldProfile | null;
  /** Hard-lock explicit genre paths — only genre-verified candidates enter ranked pool. */
  isGenreVerified?: (track: T) => boolean;
  maxPoolSize?: number;
  preserveOpener?: boolean;
  enrichTrack?: (track: T) => T;
};

export function trackIdentityKey(track: WorldIdentityTrack): string {
  return String((track as { trackId?: string }).trackId ?? `${track.artistName}:${track.trackName}`);
}

export type DeliverableTrackEnrichment = {
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  spotifyArtistGenres?: unknown;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  popularity?: number | null;
  genrePrimary?: string | null;
  genreFamily?: string | null;
  genres?: string[] | null;
};

/** Hydrate sparse pipeline/scoring rows with liked-library metadata for world identity scoring. */
export function enrichDeliverableTrack<T extends WorldIdentityTrack>(
  track: T,
  liked?: DeliverableTrackEnrichment | null,
): T {
  if (!liked) return track;
  const hasGenres =
    Array.isArray((track as { spotifyArtistGenres?: unknown }).spotifyArtistGenres) &&
    ((track as { spotifyArtistGenres?: unknown[] }).spotifyArtistGenres as unknown[]).length > 0;
  return {
    ...track,
    trackName: String(track.trackName ?? "").trim() ? track.trackName : (liked.trackName ?? track.trackName),
    artistName: String(track.artistName ?? "").trim() ? track.artistName : (liked.artistName ?? track.artistName),
    spotifyArtistGenres: hasGenres
      ? (track as { spotifyArtistGenres?: unknown }).spotifyArtistGenres
      : liked.spotifyArtistGenres,
    energy: track.energy ?? liked.energy ?? track.energy,
    valence: (track as { valence?: number | null }).valence ?? liked.valence ?? null,
    danceability: (track as { danceability?: number | null }).danceability ?? liked.danceability ?? null,
    genrePrimary: track.genrePrimary ?? liked.genrePrimary ?? track.genrePrimary,
    genreFamily: track.genreFamily ?? liked.genreFamily ?? track.genreFamily,
    genres: (track as { genres?: string[] | null }).genres ?? liked.genres ?? null,
  } as T;
}

/** Rank survivors by unified world identity — same score family as purity gate. */
export function rankDeliverableCandidates<T extends WorldIdentityTrack>(
  pool: T[],
  profile: CulturalWorldProfile,
  opts?: { isGenreVerified?: (track: T) => boolean; enrichTrack?: (track: T) => T },
): T[] {
  const atmosphericContext = resolveAtmosphericContext(profile.worldId);
  return [...pool]
    .filter((track) => {
      const artist = String(track.artistName ?? "").trim();
      if (artist && matchesAvoidArtist(artist, profile)) return false;
      if (opts?.isGenreVerified && !opts.isGenreVerified(track)) return false;
      const enriched = opts?.enrichTrack ? opts.enrichTrack(track) : track;
      if (
        atmosphericContext &&
        isAtmosphericLexicalHack(
          {
            trackName: enriched.trackName,
            artistName: enriched.artistName,
            energy: enriched.energy ?? null,
            valence: enriched.valence ?? null,
            danceability: enriched.danceability ?? null,
            acousticness: (enriched as { acousticness?: number | null }).acousticness ?? null,
            instrumentalness: enriched.instrumentalness ?? null,
            speechiness: (enriched as { speechiness?: number | null }).speechiness ?? null,
            genreFamily: enriched.genreFamily ?? null,
            genrePrimary: enriched.genrePrimary ?? null,
          },
          atmosphericContext,
        )
      ) {
        return false;
      }
      return scoreTrackWorldIdentity(enriched, profile) >= 0.5;
    })
    .sort((a, b) => {
      const enrichA = opts?.enrichTrack ? opts.enrichTrack(a) : a;
      const enrichB = opts?.enrichTrack ? opts.enrichTrack(b) : b;
      const scoreA = deliverableRankScore(enrichA, profile, atmosphericContext);
      const scoreB = deliverableRankScore(enrichB, profile, atmosphericContext);
      return scoreB - scoreA;
    });
}

function deliverableRankScore(
  track: WorldIdentityTrack,
  profile: CulturalWorldProfile,
  atmosphericContext: ReturnType<typeof resolveAtmosphericContext>,
): number {
  const identity = scoreTrackWorldIdentity(track, profile);
  if (!atmosphericContext) return identity;
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
  const atmospheric =
    scoreAtmosphericContextFit(atmosphericTrack, atmosphericContext) * 0.38 -
    atmosphericLexicalHackPenalty(atmosphericTrack, atmosphericContext) * 0.42;
  return identity * 0.62 + atmospheric;
}

/** Merge ranked survivor pools deduped by track id. */
export function mergeDeliverableCandidatePools<T extends WorldIdentityTrack>(
  ...pools: Array<T[] | undefined | null>
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const pool of pools) {
    if (!pool) continue;
    for (const track of pool) {
      const id = trackIdentityKey(track);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(track);
    }
  }
  return merged;
}

function passesDeliverableSlot<T extends WorldIdentityTrack>(
  track: T,
  profile: CulturalWorldProfile,
  position: number,
  opts: DeliverableDepthRefillOpts<T>,
): boolean {
  const isOpener = position === 0 && opts.preserveOpener === true;
  const candidate = opts.enrichTrack ? opts.enrichTrack(track) : track;
  if (isSemanticSpamTrack(candidate)) return false;
  const atmosphericContext = resolveAtmosphericContext(profile.worldId);
  if (atmosphericContext) {
    const atmosphericTrack = {
      trackName: candidate.trackName,
      artistName: candidate.artistName,
      energy: candidate.energy ?? null,
      valence: candidate.valence ?? null,
      danceability: candidate.danceability ?? null,
      acousticness: (candidate as { acousticness?: number | null }).acousticness ?? null,
      instrumentalness: candidate.instrumentalness ?? null,
      speechiness: (candidate as { speechiness?: number | null }).speechiness ?? null,
      genreFamily: candidate.genreFamily ?? null,
      genrePrimary: candidate.genrePrimary ?? null,
    };
    if (isAtmosphericLexicalHack(atmosphericTrack, atmosphericContext)) return false;
    if (scoreAtmosphericContextFit(atmosphericTrack, atmosphericContext) < 0.34) return false;
  }
  if (opts.prompt) {
    if (
      driveMomentContextPenalty(opts.prompt, {
        trackName: candidate.trackName,
        artistName: candidate.artistName,
        energy: candidate.energy ?? null,
      }) >= 0.5
    ) {
      return false;
    }
  }
  if (!trackPassesWorldPurity(candidate, profile, position, { isThesisOpener: isOpener })) return false;
  if (opts.isGenreVerified && !opts.isGenreVerified(track)) return false;
  return true;
}

/**
 * Refill deliverable depth after downstream gates thin the composed set.
 * Preserves seed order where slots pass; replaces failures and appends from ranked pool.
 */
export function refillDeliverableDepth<T extends WorldIdentityTrack>(
  seedTracks: T[],
  candidatePool: T[],
  opts: DeliverableDepthRefillOpts<T>,
): DeliverableDepthRefillResult<T> {
  const requested = Math.max(1, opts.requestedLength);
  const profile = opts.profile;
  const committed = opts.committed;

  const emptyDiagnostics = (outputCount: number): DeliverableDepthRefillDiagnostics => ({
    seedCount: seedTracks.length,
    poolSize: candidatePool.length,
    requestedLength: requested,
    outputCount,
    refilledCount: 0,
    poolExhausted: false,
    positionReplacements: 0,
    tailAppends: 0,
  });

  if (!committed?.hardLock || !profile) {
    return { tracks: seedTracks.slice(0, requested), diagnostics: emptyDiagnostics(Math.min(seedTracks.length, requested)) };
  }

  const maxPool = opts.maxPoolSize ?? 384;
  const mergedPool = mergeDeliverableCandidatePools(seedTracks, candidatePool);
  const rankedPool = rankDeliverableCandidates(mergedPool, profile, {
    isGenreVerified: opts.isGenreVerified,
    enrichTrack: opts.enrichTrack,
  }).slice(0, maxPool);

  const usedIds = new Set<string>();
  const output: T[] = [];
  let positionReplacements = 0;
  let tailAppends = 0;

  const takeNextRanked = (position: number): T | null => {
    for (const candidate of rankedPool) {
      const id = trackIdentityKey(candidate);
      if (usedIds.has(id)) continue;
      if (!passesDeliverableSlot(candidate, profile, position, opts)) continue;
      usedIds.add(id);
      return opts.enrichTrack ? opts.enrichTrack(candidate) : candidate;
    }
    return null;
  };

  for (let i = 0; i < seedTracks.length && output.length < requested; i += 1) {
    const seed = seedTracks[i]!;
    const seedId = trackIdentityKey(seed);
    const position = output.length;
    if (!usedIds.has(seedId) && passesDeliverableSlot(seed, profile, position, opts)) {
      usedIds.add(seedId);
      output.push(opts.enrichTrack ? opts.enrichTrack(seed) : seed);
      continue;
    }
    const replacement = takeNextRanked(position);
    if (replacement) {
      output.push(replacement);
      positionReplacements += 1;
    }
  }

  while (output.length < requested) {
    const appended = takeNextRanked(output.length);
    if (!appended) break;
    output.push(appended);
    tailAppends += 1;
  }

  const refilledCount = positionReplacements + tailAppends;
  const poolExhausted = output.length < requested && usedIds.size >= rankedPool.length;

  void opts.prompt;

  const cleaned = output.filter((track) => !isSemanticSpamTrack(track));

  return {
    tracks: cleaned,
    diagnostics: {
      seedCount: seedTracks.length,
      poolSize: rankedPool.length,
      requestedLength: requested,
      outputCount: cleaned.length,
      refilledCount,
      poolExhausted,
      positionReplacements,
      tailAppends,
    },
  };
}

export type ArtistCapRefillOpts<T extends WorldIdentityTrack> = DeliverableDepthRefillOpts<T> & {
  perArtistCap: number;
  promptCentralArtists?: ReadonlySet<string>;
  /** When false, skip purity gate (soft-world paths). */
  enforceWorldPurity?: boolean;
};

function artistCapLimit(
  artist: string,
  perArtistCap: number,
  promptCentralArtists: ReadonlySet<string>,
  playlistSize: number,
): number {
  if (perArtistCap >= Number.MAX_SAFE_INTEGER / 2) return perArtistCap;
  for (const central of promptCentralArtists) {
    if (artist.includes(central) || central.includes(artist)) {
      return Math.max(perArtistCap, Math.ceil(playlistSize * 0.22));
    }
  }
  return perArtistCap;
}

function artistCountInPlaylist<T extends { artistName?: string | null }>(tracks: T[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const artist = normalizeSessionArtist(track.artistName ?? "");
    if (!artist) continue;
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return counts;
}

function canAddUnderArtistCap<T extends { artistName?: string | null }>(
  track: T,
  output: T[],
  opts: { perArtistCap: number; promptCentralArtists: ReadonlySet<string>; requestedLength: number },
): boolean {
  const artist = normalizeSessionArtist(track.artistName ?? "");
  if (!artist) return true;
  const limit = artistCapLimit(artist, opts.perArtistCap, opts.promptCentralArtists, opts.requestedLength);
  const count = output.filter((t) => normalizeSessionArtist(t.artistName ?? "") === artist).length;
  return count < limit;
}

function rankForArtistDiverseRefill<T extends WorldIdentityTrack>(
  pool: T[],
  profile: CulturalWorldProfile | null,
  artistCounts: Map<string, number>,
  opts: Pick<ArtistCapRefillOpts<T>, "isGenreVerified" | "enrichTrack">,
): T[] {
  return [...pool].sort((a, b) => {
    const enrichA = opts.enrichTrack ? opts.enrichTrack(a) : a;
    const enrichB = opts.enrichTrack ? opts.enrichTrack(b) : b;
    const scoreA = profile ? scoreTrackWorldIdentity(enrichA, profile) : 0.55;
    const scoreB = profile ? scoreTrackWorldIdentity(enrichB, profile) : 0.55;
    const artistA = normalizeSessionArtist(a.artistName ?? "");
    const artistB = normalizeSessionArtist(b.artistName ?? "");
    const penaltyA = (artistCounts.get(artistA) ?? 0) * 0.12;
    const penaltyB = (artistCounts.get(artistB) ?? 0) * 0.12;
    return scoreB - penaltyB - (scoreA - penaltyA);
  });
}

/**
 * V36 — refill after artist-cap pruning using ranked survivor pool with per-artist diversity.
 * Fills toward requested length without re-concentrating on already-capped artists.
 */
export function refillAfterArtistCap<T extends WorldIdentityTrack & { artistName?: string | null }>(
  cappedTracks: T[],
  candidatePool: T[],
  opts: ArtistCapRefillOpts<T>,
): DeliverableDepthRefillResult<T> {
  const requested = Math.max(1, opts.requestedLength);
  const profile = opts.profile;
  const enforcePurity = opts.enforceWorldPurity !== false && opts.committed?.hardLock === true && !!profile;
  const centralArtists = opts.promptCentralArtists ?? new Set<string>();
  const capOpts = { perArtistCap: opts.perArtistCap, promptCentralArtists: centralArtists, requestedLength: requested };

  if (cappedTracks.length >= requested) {
    return {
      tracks: cappedTracks.slice(0, requested),
      diagnostics: {
        seedCount: cappedTracks.length,
        poolSize: candidatePool.length,
        requestedLength: requested,
        outputCount: Math.min(cappedTracks.length, requested),
        refilledCount: 0,
        poolExhausted: false,
        positionReplacements: 0,
        tailAppends: 0,
      },
    };
  }

  const usedIds = new Set(cappedTracks.map((t) => trackIdentityKey(t)));
  const output = [...cappedTracks];
  let tailAppends = 0;

  const mergedPool = mergeDeliverableCandidatePools(cappedTracks, candidatePool).filter((t) => {
    const id = trackIdentityKey(t);
    if (usedIds.has(id)) return false;
    if (opts.isGenreVerified && !opts.isGenreVerified(t)) return false;
    const artist = String(t.artistName ?? "").trim();
    if (profile && artist && matchesAvoidArtist(artist, profile)) return false;
    return true;
  });

  const maxPool = opts.maxPoolSize ?? 384;
  let ranked = mergedPool.slice(0, maxPool);

  while (output.length < requested && ranked.length > 0) {
    const artistCounts = artistCountInPlaylist(output);
    ranked = rankForArtistDiverseRefill(ranked, profile, artistCounts, opts);
    let added = false;
    for (let i = 0; i < ranked.length; i += 1) {
      const candidate = ranked[i]!;
      const id = trackIdentityKey(candidate);
      if (usedIds.has(id)) continue;
      if (!canAddUnderArtistCap(candidate, output, capOpts)) continue;
      const enriched = opts.enrichTrack ? opts.enrichTrack(candidate) : candidate;
      if (enforcePurity && profile) {
        if (!trackPassesWorldPurity(enriched, profile, output.length, { isThesisOpener: output.length === 0 && opts.preserveOpener })) {
          continue;
        }
      } else if (profile) {
        if (scoreTrackWorldIdentity(enriched, profile) < 0.5) continue;
      }
      usedIds.add(id);
      output.push(enriched);
      ranked.splice(i, 1);
      tailAppends += 1;
      added = true;
      break;
    }
    if (!added) break;
  }

  return {
    tracks: output,
    diagnostics: {
      seedCount: cappedTracks.length,
      poolSize: mergedPool.length,
      requestedLength: requested,
      outputCount: output.length,
      refilledCount: tailAppends,
      poolExhausted: output.length < requested,
      positionReplacements: 0,
      tailAppends,
    },
  };
}
