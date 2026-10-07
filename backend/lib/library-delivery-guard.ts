/**
 * Final library-purity boundary for /generate.
 *
 * In normal library mode (noLibraryMode === false) every delivered track must be
 * one of the user's Liked Songs. Earlier stages (world expansion, thesis opener,
 * purity/human-curation replacement pools) can carry Spotify catalogue tracks, so
 * this runs immediately before the Spotify / saved-playlist / result-cache side
 * effects and does not trust any earlier filter.
 *
 * Discovery Mode (noLibraryMode === true) is intentionally untouched.
 */

export type LibraryDeliveryGuardResult<T> = {
  tracks: T[];
  removed: T[];
  /** True when the guard was applied (library mode). */
  enforced: boolean;
};

export function buildLibraryTrackIdSet(
  library: ReadonlyArray<{ trackId?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const track of library) {
    if (typeof track.trackId === "string" && track.trackId) ids.add(track.trackId);
  }
  return ids;
}

export function enforceLibraryDeliveryPurity<T>(
  tracks: readonly T[],
  opts: {
    noLibraryMode: boolean;
    libraryTrackIds: ReadonlySet<string>;
    getTrackId: (track: T) => string | null | undefined;
  },
): LibraryDeliveryGuardResult<T> {
  if (opts.noLibraryMode) {
    return { tracks: [...tracks], removed: [], enforced: false };
  }
  const kept: T[] = [];
  const removed: T[] = [];
  for (const track of tracks) {
    const id = opts.getTrackId(track);
    // Tracks without a verifiable id are rejected rather than assumed to be liked.
    if (typeof id === "string" && id && opts.libraryTrackIds.has(id)) kept.push(track);
    else removed.push(track);
  }
  return { tracks: kept, removed, enforced: true };
}
