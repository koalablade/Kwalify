/**
 * Per-user playlist result cache — instant repeat for same prompt + scene kind.
 */

import type { EmotionProfile } from "./emotion";
import { buildGenerateCacheKey } from "./generate-cache-key";
import { GENERATE_RESULT_CACHE_TTL_MS } from "./production-limits";
import { evictOldestEntries } from "./cache-eviction";
import type { V3TrackMetadata } from "./v3-track-contract";

export type CachedGeneratePayload = {
  /** v2: adds genrePrimary per track. Entries without this field are treated as cache misses. */
  cacheVersion: "v2";
  playlistName: string;
  vibe: string;
  mode: string;
  finalTracks: Array<Record<string, unknown> & V3TrackMetadata & {
    trackId: string;
    trackName: string;
    artistName: string;
    albumName: string;
    albumArt: string | null;
    durationMs: number | null;
    energy: number | null;
    valence: number | null;
    tempo: number | null;
    score: number;
    rediscoveryScore?: number;
    narrativeRole?: string;
    genrePrimary: string | null;
  }>;
  emotionProfile: EmotionProfile & { journeyArc?: string };
  spotifyPlaylistUrl: string | null;
  v3Diagnostics?: Record<string, unknown> | null;
  cachedAt: number;
};

const cache = new Map<string, CachedGeneratePayload>();

export function getGenerateCacheKey(
  input: Parameters<typeof buildGenerateCacheKey>[0]
): string {
  return buildGenerateCacheKey(input);
}

export function getCachedGenerateResult(
  key: string
): CachedGeneratePayload | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > GENERATE_RESULT_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
}

export function setCachedGenerateResult(
  key: string,
  payload: CachedGeneratePayload
): void {
  cache.set(key, payload);
  evictOldestEntries(cache, 400, 80);
}
