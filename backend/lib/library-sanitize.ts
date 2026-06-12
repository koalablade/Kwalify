/**
 * Drop corrupted liked-song rows before scoring / compose.
 */

export function sanitizeLikedSongs<
  T extends {
    trackId: string;
    trackName: string;
    artistName: string;
  }
>(rows: T[]): { valid: T[]; dropped: number } {
  const valid: T[] = [];
  const seenTrackIds = new Set<string>();
  let dropped = 0;
  for (const t of rows) {
    if (
      !t ||
      typeof t.trackId !== "string" ||
      t.trackId.length < 8 ||
      typeof t.trackName !== "string" ||
      !t.trackName.trim() ||
      typeof t.artistName !== "string" ||
      !t.artistName.trim()
    ) {
      dropped++;
      continue;
    }
    const trackId = t.trackId.trim();
    if (seenTrackIds.has(trackId)) {
      dropped++;
      continue;
    }
    seenTrackIds.add(trackId);
    valid.push(t);
  }
  return { valid, dropped };
}
