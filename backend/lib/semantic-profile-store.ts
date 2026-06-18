/**
 * In-memory semantic profile index per user — hydrated from liked_songs.semantic_profile.
 */

import type { TrackSemanticProfile } from "./track-semantic-types";
import { enrichTrackSemanticProfile, parseTrackSemanticProfile, type EnrichmentTrackInput } from "./track-semantic-enrichment";
import { evictOldestEntries } from "./cache-eviction";

type CacheEntry = {
  profiles: Map<string, TrackSemanticProfile>;
  trackCount: number;
  builtAt: number;
};

const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_VERSION = "semantic-profile-v1";

function cacheKey(userId: string): string {
  return `${CACHE_VERSION}:${userId}`;
}

export type SemanticTrackRow = EnrichmentTrackInput & {
  semanticProfile?: unknown;
  primaryArtistId?: string | null;
  artistIds?: unknown;
};

export function buildSemanticProfileMap(tracks: SemanticTrackRow[]): Map<string, TrackSemanticProfile> {
  const map = new Map<string, TrackSemanticProfile>();
  for (const track of tracks) {
    const parsed = parseTrackSemanticProfile(track.semanticProfile);
    map.set(
      track.trackId,
      parsed ?? enrichTrackSemanticProfile({
        ...track,
        artistIds: Array.isArray(track.artistIds)
          ? track.artistIds.filter((id): id is string => typeof id === "string")
          : null,
      }),
    );
  }
  return map;
}

export function getUserSemanticProfiles(
  userId: string,
  tracks: SemanticTrackRow[],
  opts?: { bypassCache?: boolean },
): { profiles: Map<string, TrackSemanticProfile>; cacheHit: boolean } {
  const key = cacheKey(userId);
  const entry = cache.get(key);
  const now = Date.now();
  if (!opts?.bypassCache && entry && entry.trackCount === tracks.length && now - entry.builtAt < TTL_MS) {
    return { profiles: entry.profiles, cacheHit: true };
  }
  const profiles = buildSemanticProfileMap(tracks);
  cache.set(key, { profiles, trackCount: tracks.length, builtAt: now });
  evictOldestEntries(cache, 300, 40);
  return { profiles, cacheHit: false };
}

export function invalidateSemanticProfileCache(userId: string): void {
  cache.delete(cacheKey(userId));
}

export function warmSemanticProfileCache(userId: string, tracks: SemanticTrackRow[]): Map<string, TrackSemanticProfile> {
  const { profiles } = getUserSemanticProfiles(userId, tracks, { bypassCache: true });
  return profiles;
}

export function enrichRowsForInsert(
  tracks: Array<SemanticTrackRow & { artistIds?: string[] | null }>,
): Array<{ semanticProfile: TrackSemanticProfile; primaryArtistId: string | null; artistIds: string[] }> {
  return tracks.map((track) => {
    const profile = enrichTrackSemanticProfile(track);
    const artistIds = track.artistIds ?? [];
    return {
      semanticProfile: profile,
      primaryArtistId: artistIds[0] ?? track.primaryArtistId ?? null,
      artistIds,
    };
  });
}
