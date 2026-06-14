/**
 * In-memory genre profile cache — avoid re-classifying 10k tracks every generate.
 */

import type { UserGenreProfile } from "./user-genre-profile";
import { buildUserGenreProfile } from "./user-genre-profile";
import { evictOldestEntries } from "./cache-eviction";
import { logger } from "./logger";

type CacheEntry = {
  profile: UserGenreProfile;
  trackCount: number;
  builtAt: number;
};

const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000;
const GENRE_PROFILE_CACHE_VERSION = "genre-profile-v3-country-evidence";

function profileCacheKey(userId: string): string {
  return `${GENRE_PROFILE_CACHE_VERSION}:${userId}`;
}

export function getUserGenreProfileForGenerate(
  userId: string,
  tracks: Parameters<typeof buildUserGenreProfile>[0],
  vibe?: string,
  opts?: { bypassCache?: boolean }
): { profile: UserGenreProfile; cacheHit: boolean } {
  const key = profileCacheKey(userId);
  const entry = cache.get(key);
  const now = Date.now();
  if (
    !opts?.bypassCache &&
    entry &&
    entry.trackCount === tracks.length &&
    now - entry.builtAt < TTL_MS
  ) {
    return { profile: entry.profile, cacheHit: true };
  }

  const t0 = Date.now();
  const profile = buildUserGenreProfile(tracks);
  logger.debug({
    ms: Date.now() - t0,
    trackCount: tracks.length,
    cacheHit: false,
  }, "[generate-timing] getUserGenreProfileForGenerate");
  if (!opts?.bypassCache) {
    cache.set(key, { profile, trackCount: tracks.length, builtAt: now });
    evictOldestEntries(cache, 300, 40);
  }
  return { profile, cacheHit: false };
}

export function invalidateGenreProfileCache(userId: string): void {
  for (const k of cache.keys()) {
    if (k === profileCacheKey(userId) || k.endsWith(`:${userId}`)) cache.delete(k);
  }
}

/** Pre-build profile after sync so first generate is fast. */
export function warmGenreProfileCache(
  userId: string,
  tracks: Parameters<typeof buildUserGenreProfile>[0]
): void {
  if (!tracks.length) return;
  const profile = buildUserGenreProfile(tracks);
  const key = profileCacheKey(userId);
  cache.set(key, {
    profile,
    trackCount: tracks.length,
    builtAt: Date.now(),
  });
}
