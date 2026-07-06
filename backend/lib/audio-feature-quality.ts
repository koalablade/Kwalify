/** Penalize tracks missing Spotify audio features (avoids neutral 0.5 clustering). */

export function hasAudioFeatures(track: {
  energy: number | null;
  valence: number | null;
}): boolean {
  return track.energy != null && track.valence != null;
}

/** Deterministic score multiplier — null features rank lower, not excluded. */
export function audioFeatureQualityMultiplier(track: {
  energy: number | null;
  valence: number | null;
}): number {
  return hasAudioFeatures(track) ? 1 : 0.62;
}
