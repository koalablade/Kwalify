/**
 * Soft dominance targets — exponential penalty curves (not hard clipping).
 */

import type { RootGenre } from "../../lib/genre-taxonomy";

/** Soft target band — ideal max share per genre in playlist. */
export const SOFT_GENRE_TARGET = 0.55;

/** Hard backstop — preserves coherence while still preventing total monoculture. */
export const HARD_GENRE_BACKSTOP = 0.80;

/** Rolling window size for genre diversity enforcement */
export const GENRE_ROLLING_WINDOW = 12;

/** Inject counter-genre tracks sparingly; constant variation harms flow. */
export const COUNTER_GENRE_INJECTION_INTERVAL = 8;

/**
 * Exponential penalty when genre share exceeds soft target.
 * penalty = exp((share - target) * k) - 1, scaled for score multipliers
 */
export function dominancePenaltyMultiplier(
  genreShare: number,
  target = SOFT_GENRE_TARGET,
  steepness = 6
): number {
  if (genreShare <= target) return 1;
  const excess = genreShare - target;
  const penalty = Math.exp(excess * steepness) - 1;
  return Math.max(0.55, 1 / (1 + penalty * 0.85));
}

export function collapseRiskScore(poolDist: Record<string, number>): number {
  const values = Object.values(poolDist).sort((a, b) => b - a);
  if (values.length === 0) return 1;
  const top = values[0] ?? 0;
  const second = values[1] ?? 0;
  const concentration = top + second * 0.5;
  return Math.round(Math.min(1, Math.max(0, concentration * 1.15)) * 1000) / 1000;
}

export function safeDistributionTargets(
  userVector: Partial<Record<RootGenre, number>>,
  playlistLength: number,
  eligibleGenres: RootGenre[]
): Record<string, number> {
  const targets: Record<string, number> = {};
  const totalUser = eligibleGenres.reduce((s, g) => s + (userVector[g] ?? 0), 0) || 1;
  for (const g of eligibleGenres) {
    const raw = (userVector[g] ?? 0) / totalUser;
    targets[g] = Math.round(Math.min(SOFT_GENRE_TARGET, Math.max(0.04, raw)) * 1000) / 1000;
  }
  void playlistLength;
  return targets;
}
