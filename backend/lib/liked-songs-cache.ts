import type { LikedSong } from "../db";
import { evictOldestEntries } from "./cache-eviction";

type CacheEntry = {
  rows: LikedSong[];
  builtAt: number;
  sourceSyncedAtMs: number | null;
};

const cache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000;
const MAX_USERS = 150;

export function likedSongsCacheTtlMs(): number {
  return TTL_MS;
}

export function getCachedLikedSongs(
  userId: string,
  opts?: { minSyncedAtMs?: number | null },
): LikedSong[] | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.builtAt > TTL_MS) {
    cache.delete(userId);
    return null;
  }
  const minSyncedAtMs = opts?.minSyncedAtMs;
  if (typeof minSyncedAtMs === "number") {
    const sourceMs = entry.sourceSyncedAtMs ?? entry.builtAt;
    if (sourceMs < minSyncedAtMs) {
      cache.delete(userId);
      return null;
    }
  }
  return entry.rows;
}

export function setCachedLikedSongs(
  userId: string,
  rows: LikedSong[],
  sourceSyncedAtMs?: number | null,
): void {
  cache.set(userId, {
    rows,
    builtAt: Date.now(),
    sourceSyncedAtMs: sourceSyncedAtMs ?? null,
  });
  evictOldestEntries(cache, MAX_USERS, 25);
}

export function invalidateLikedSongsCache(userId: string): void {
  cache.delete(userId);
}
