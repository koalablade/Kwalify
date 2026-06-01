/**
 * In-memory genre profile cache — avoid re-classifying 10k tracks every generate.
 */

import type { UserGenreProfile } from "./user-genre-profile";
import { buildUserGenreProfile } from "./user-genre-profile";

type CacheEntry = {
  profile: UserGenreProfile;
  trackCount: number;
  builtAt: number;
};

const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000;

export function getUserGenreProfileForGenerate(
  userId: string,
  tracks: Parameters<typeof buildUserGenreProfile>[0],
  vibe?: string
): { profile: UserGenreProfile; cacheHit: boolean } {
  const entry = cache.get(userId);
  const now = Date.now();
  if (
    entry &&
    entry.trackCount === tracks.length &&
    now - entry.builtAt < TTL_MS
  ) {
    return { profile: entry.profile, cacheHit: true };
  }

  const profile = buildUserGenreProfile(tracks, vibe);
  cache.set(userId, { profile, trackCount: tracks.length, builtAt: now });
  return { profile, cacheHit: false };
}

export function invalidateGenreProfileCache(userId: string): void {
  cache.delete(userId);
}
