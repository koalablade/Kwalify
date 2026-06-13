import type { LikedSong } from "../db";
import { evictOldestEntries } from "./cache-eviction";

type CacheEntry = {
  rows: LikedSong[];
  builtAt: number;
};

const cache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000;
const MAX_USERS = 150;

export function getCachedLikedSongs(userId: string): LikedSong[] | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.builtAt > TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return entry.rows;
}

export function setCachedLikedSongs(userId: string, rows: LikedSong[]): void {
  cache.set(userId, { rows, builtAt: Date.now() });
  evictOldestEntries(cache, MAX_USERS, 25);
}

export function invalidateLikedSongsCache(userId: string): void {
  cache.delete(userId);
}
