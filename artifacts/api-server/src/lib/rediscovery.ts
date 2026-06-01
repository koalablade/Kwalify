/**
 * Rediscovery jitter — main scoring lives in forgotten-favourites.ts.
 */

/** Small jitter so equal-scoring deep cuts surface on regenerate. */
export function rediscoveryJitter(trackId: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < trackId.length; i++) {
    h = (h * 31 + trackId.charCodeAt(i)) | 0;
  }
  return ((h & 0xffff) / 0xffff) * 0.04 - 0.02;
}
