/**
 * Production caps — no full-library scoring, graph, or trace work.
 */

import type { VibeKind } from "./emotion";

export const LARGE_LIBRARY_THRESHOLD = 3000;

/** Max tracks classified when building genre profile (cache miss). */
export const GENRE_PROFILE_MAX_TRACKS = 2200;

export const HYBRID_POOL_SIMPLE = 800;
export const HYBRID_POOL_STANDARD = 1000;
export const HYBRID_POOL_COMPLEX = 1500;
export const HYBRID_POOL_ABSOLUTE_MAX = 2000;

export const MINIMAL_GENRE_STACK_THRESHOLD = 500;

export const TRACE_SAMPLE_SIZE = 40;
export const TRACE_MAX_TOTAL = 45;

/** Hard server budget for /generate (ms). */
export const REQUEST_HARD_TIMEOUT_MS = 90_000;
/** Switch to fast fallback if pipeline not done by this point (ms from request start). */
export const REQUEST_FAST_FALLBACK_MS = 68_000;

export const GENERATE_RESULT_CACHE_TTL_MS = 20 * 60 * 1000;
export const GENRE_STACK_CACHE_TTL_MS = 60 * 60 * 1000;

export function resolveHybridPoolCap(
  librarySize: number,
  opts: { referencePlaylist?: boolean; vibeKind?: VibeKind; promptWordCount?: number }
): number {
  if (librarySize <= LARGE_LIBRARY_THRESHOLD) {
    return librarySize <= 1500 ? HYBRID_POOL_STANDARD : HYBRID_POOL_COMPLEX;
  }
  if (librarySize > 5000) {
    return HYBRID_POOL_ABSOLUTE_MAX;
  }
  let cap = HYBRID_POOL_COMPLEX;
  if (opts.referencePlaylist) cap = Math.min(cap + 100, HYBRID_POOL_ABSOLUTE_MAX);
  if ((opts.promptWordCount ?? 0) >= 12) cap = HYBRID_POOL_ABSOLUTE_MAX;
  if (opts.vibeKind === "sunny" || opts.vibeKind === "night") {
    cap = Math.min(cap + 100, HYBRID_POOL_ABSOLUTE_MAX);
  }
  return Math.min(cap, HYBRID_POOL_ABSOLUTE_MAX);
}
