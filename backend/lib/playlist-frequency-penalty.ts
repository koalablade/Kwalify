/**
 * Cross-playlist frequency penalty — avoid the same safe tracks dominating recovery.
 */

export function playlistFrequencyMultiplier(appearanceCount: number): number {
  if (appearanceCount <= 0) return 1;
  if (appearanceCount === 1) return 0.92;
  if (appearanceCount <= 3) return 0.82;
  if (appearanceCount <= 5) return 0.68;
  if (appearanceCount <= 10) return 0.48;
  if (appearanceCount <= 20) return 0.28;
  return 0.12;
}

export function buildPlaylistFrequencyPenalty(
  previousTrackIds: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const trackId of previousTrackIds) {
    counts.set(trackId, (counts.get(trackId) ?? 0) + 1);
  }
  const penalty = new Map<string, number>();
  for (const [trackId, count] of counts) {
    penalty.set(trackId, playlistFrequencyMultiplier(count));
  }
  return penalty;
}

export function applyFrequencyPenaltyToScore(
  baseScore: number,
  trackId: string,
  penaltyMap: Map<string, number> | undefined,
): number {
  const multiplier = penaltyMap?.get(trackId) ?? 1;
  return baseScore * multiplier;
}
