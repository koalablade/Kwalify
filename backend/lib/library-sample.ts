/**
 * Stratified library sample — avoids O(n) genre detection on 9k+ likes.
 */

function seededJitter(trackId: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < trackId.length; i++) h = (h * 31 + trackId.charCodeAt(i)) | 0;
  return (h & 0xffff) / 0xffff;
}

export function sampleTracksForProfile<T extends { trackId: string }>(
  tracks: T[],
  maxTracks: number,
  seedMs = 0
): T[] {
  if (tracks.length <= maxTracks) return tracks;

  const ranked = tracks.map((t) => ({
    t,
    j: seededJitter(t.trackId, seedMs),
  }));
  ranked.sort((a, b) => b.j - a.j);
  return ranked.slice(0, maxTracks).map((x) => x.t);
}
