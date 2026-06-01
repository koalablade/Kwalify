import type { GenreIntelligenceStack } from "./genre-intelligence-stack";
import { GENRE_STACK_CACHE_TTL_MS } from "./production-limits";
import { evictOldestEntries } from "./cache-eviction";

type Entry = { stack: GenreIntelligenceStack; builtAt: number };

const cache = new Map<string, Entry>();

export function getCachedGenreStack(key: string): GenreIntelligenceStack | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.builtAt > GENRE_STACK_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e.stack;
}

export function setCachedGenreStack(key: string, stack: GenreIntelligenceStack): void {
  cache.set(key, { stack, builtAt: Date.now() });
  evictOldestEntries(cache, 250, 35);
}
