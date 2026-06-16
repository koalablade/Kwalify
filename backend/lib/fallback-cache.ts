import { createHash } from "node:crypto";
import { moduleLogger } from "./logger";

const log = moduleLogger("fallback-cache");

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 100;
const caches = new Map<string, CacheEntry<unknown>>();

export function requestPatternKey(namespace: string, input: unknown): string {
  const hash = createHash("sha1").update(JSON.stringify(input)).digest("hex").slice(0, 16);
  return `${namespace}:${hash}`;
}

export function setFallbackCache<T>(
  key: string,
  value: T,
  opts: { ttlMs?: number; maxEntries?: number } = {},
): void {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  caches.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (caches.size > maxEntries) {
    const oldest = caches.keys().next().value as string | undefined;
    if (!oldest) break;
    caches.delete(oldest);
  }
}

export function getFallbackCache<T>(key: string): T | null {
  const entry = caches.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    caches.delete(key);
    return null;
  }
  log.info({ cacheKey: key }, "fallback_cache_hit");
  return entry.value as T;
}

export function getFallbackCacheStats(): {
  size: number;
  maxEntries: number;
  ttlMs: number;
  expiredEntries: number;
} {
  const now = Date.now();
  let expiredEntries = 0;
  for (const entry of caches.values()) {
    if (entry.expiresAt < now) expiredEntries += 1;
  }
  return {
    size: caches.size,
    maxEntries: DEFAULT_MAX_ENTRIES,
    ttlMs: DEFAULT_TTL_MS,
    expiredEntries,
  };
}

export function clearFallbackCacheForValidation(): void {
  caches.clear();
}
