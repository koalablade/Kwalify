/**
 * Shared bounded-cache eviction helper.
 */

export function evictOldestEntries<K, V extends { builtAt?: number; cachedAt?: number }>(
  map: Map<K, V>,
  maxSize: number,
  evictCount: number
): void {
  if (map.size <= maxSize) return;
  const sorted = [...map.entries()].sort((a, b) => {
    const ta = a[1].cachedAt ?? a[1].builtAt ?? 0;
    const tb = b[1].cachedAt ?? b[1].builtAt ?? 0;
    return ta - tb;
  });
  for (let i = 0; i < evictCount && i < sorted.length; i++) {
    map.delete(sorted[i]![0]);
  }
}
