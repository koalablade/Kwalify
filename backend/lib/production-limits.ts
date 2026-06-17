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
export const HYBRID_POOL_ABSOLUTE_MAX = 1400;
export const LARGE_LIBRARY_HYBRID_POOL_MAX = 1000;

export const MINIMAL_GENRE_STACK_THRESHOLD = 500;

export const TRACE_SAMPLE_SIZE = 40;
export const TRACE_MAX_TOTAL = 45;

/** Hard server budget for /generate (ms). */
export const REQUEST_HARD_TIMEOUT_MS = 28_000;
/** Switch to fast fallback if pipeline not done by this point (ms from request start). */
export const REQUEST_FAST_FALLBACK_MS = 24_000;

export const GENERATE_RESULT_CACHE_TTL_MS = 20 * 60 * 1000;
export const GENRE_STACK_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Max 40% ANN pre-filter reduction rule (spec §6):
 * The pool fed into scoring must retain at least 60% of the original library.
 * Returns the MINIMUM pool size that must be preserved.
 */
export function minPoolAfterPreFilter(librarySize: number): number {
  return Math.ceil(librarySize * 0.60);
}

export function resolveHybridPoolCap(
  librarySize: number,
  opts: { referencePlaylist?: boolean; vibeKind?: VibeKind; promptWordCount?: number }
): number {
  if (librarySize <= LARGE_LIBRARY_THRESHOLD) {
    // Spec §6: for small/medium libraries, preserve at least 60% of the source pool.
    const minRetained = minPoolAfterPreFilter(librarySize);
    return Math.max(minRetained, librarySize <= 1500 ? HYBRID_POOL_STANDARD : HYBRID_POOL_COMPLEX);
  }

  // Large libraries must use a true HTTP-safe ceiling. Preserving 60% of a
  // 9k+ library pushes thousands of tracks through synchronous hybrid/V3
  // scoring and can block the event loop long enough for watchdog timers to
  // miss their response window.
  let cap = LARGE_LIBRARY_HYBRID_POOL_MAX;
  if (opts.referencePlaylist) cap = Math.min(cap + 100, HYBRID_POOL_ABSOLUTE_MAX);
  if ((opts.promptWordCount ?? 0) >= 12) cap = Math.min(HYBRID_POOL_ABSOLUTE_MAX, cap + 300);
  if (opts.vibeKind === "sunny" || opts.vibeKind === "late_night") {
    cap = Math.min(cap + 100, HYBRID_POOL_ABSOLUTE_MAX);
  }
  return Math.min(cap, HYBRID_POOL_ABSOLUTE_MAX);
}
