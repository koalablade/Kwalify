/**
 * Unified in-process cache entry budget across hot-path caches.
 * Set KWALIFY_CACHE_ENTRY_BUDGET to tune total retained entries (default 1200).
 */

export type CacheBudgetName = "generateResult" | "genreStack" | "sessionSnapshot";

const CACHE_SHARE: Record<CacheBudgetName, number> = {
  generateResult: 0.45,
  genreStack: 0.30,
  sessionSnapshot: 0.25,
};

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function totalCacheEntryBudget(): number {
  return envInt("KWALIFY_CACHE_ENTRY_BUDGET", 1200);
}

export function cacheMaxEntries(name: CacheBudgetName, floor: number): number {
  const share = CACHE_SHARE[name] ?? 0.2;
  return Math.max(floor, Math.floor(totalCacheEntryBudget() * share));
}

export function cacheEvictBatch(maxEntries: number): number {
  return Math.max(8, Math.floor(maxEntries * 0.12));
}
