/**
 * In-memory genre profile cache — avoid re-classifying 10k tracks every generate.
 */

import type { UserGenreProfile } from "./user-genre-profile";
import { buildUserGenreProfile } from "./user-genre-profile";
import { normalizePrompt } from "./generate-cache-key";
import { evictOldestEntries } from "./cache-eviction";

type CacheEntry = {
  profile: UserGenreProfile;
  trackCount: number;
  vibeKey: string;
  builtAt: number;
};

const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000;

function profileCacheKey(userId: string, vibe?: string): string {
  return `${userId}:${normalizePrompt(vibe ?? "")}`;
}

export function getUserGenreProfileForGenerate(
  userId: string,
  tracks: Parameters<typeof buildUserGenreProfile>[0],
  vibe?: string
): { profile: UserGenreProfile; cacheHit: boolean } {
  const vibeKey = normalizePrompt(vibe ?? "");
  const key = profileCacheKey(userId, vibe);
  const entry = cache.get(key);
  const now = Date.now();
  if (
    entry &&
    entry.trackCount === tracks.length &&
    entry.vibeKey === vibeKey &&
    now - entry.builtAt < TTL_MS
  ) {
    return { profile: entry.profile, cacheHit: true };
  }

  const profile = buildUserGenreProfile(tracks, vibe);
  cache.set(key, { profile, trackCount: tracks.length, vibeKey, builtAt: now });
  evictOldestEntries(cache, 300, 40);
  return { profile, cacheHit: false };
}

export function invalidateGenreProfileCache(userId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${userId}:`)) cache.delete(k);
  }
}

/** Pre-build profile after sync so first generate is fast. */
export function warmGenreProfileCache(
  userId: string,
  tracks: Parameters<typeof buildUserGenreProfile>[0]
): void {
  if (!tracks.length) return;
  const profile = buildUserGenreProfile(tracks);
  const key = profileCacheKey(userId, "");
  cache.set(key, {
    profile,
    trackCount: tracks.length,
    vibeKey: "",
    builtAt: Date.now(),
  });
}
