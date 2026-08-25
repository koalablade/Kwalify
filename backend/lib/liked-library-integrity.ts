/**
 * Liked-library integrity guards.
 * These do not change playlist scoring. They prevent a partial or stale
 * Spotify fetch from being treated as the user's current liked songs.
 */

export const LIKED_LIBRARY_INTEGRITY_FIX = "LIKED_LIBRARY_INTEGRITY_FIX";

export type SavedTracksPage = {
  offset: number;
  limit: number;
  total: number;
  rawItemCount: number;
  next: string | null | undefined;
};

export type SavedTracksFetchAudit = {
  spotifyTotal: number | null;
  pages: SavedTracksPage[];
  rawItemCount: number;
  localOrNullCount: number;
  usableTrackCount: number;
  complete: boolean;
  reason: string;
};

export function expectedSavedTrackPages(spotifyTotal: number, pageLimit: number): number {
  if (spotifyTotal <= 0) return 0;
  return Math.ceil(spotifyTotal / pageLimit);
}

export function auditSavedTracksFetch(input: {
  spotifyTotal: number | null;
  pages: SavedTracksPage[];
  localOrNullCount: number;
  usableTrackCount: number;
}): SavedTracksFetchAudit {
  const pages = input.pages;
  const rawItemCount = pages.reduce((sum, page) => sum + page.rawItemCount, 0);
  const spotifyTotal = input.spotifyTotal;
  if (spotifyTotal == null || !Number.isFinite(spotifyTotal)) {
    return {
      spotifyTotal,
      pages,
      rawItemCount,
      localOrNullCount: input.localOrNullCount,
      usableTrackCount: input.usableTrackCount,
      complete: false,
      reason: "Spotify total missing — fetch is not authoritative",
    };
  }
  if (pages.length === 0 && spotifyTotal > 0) {
    return {
      spotifyTotal,
      pages,
      rawItemCount,
      localOrNullCount: input.localOrNullCount,
      usableTrackCount: input.usableTrackCount,
      complete: false,
      reason: "No pages consumed while Spotify total > 0",
    };
  }
  const expectedPages = expectedSavedTrackPages(spotifyTotal, pages[0]?.limit ?? 50);
  if (pages.length < expectedPages) {
    return {
      spotifyTotal,
      pages,
      rawItemCount,
      localOrNullCount: input.localOrNullCount,
      usableTrackCount: input.usableTrackCount,
      complete: false,
      reason: `Pagination stopped early: ${pages.length} pages of ${expectedPages} expected`,
    };
  }
  if (rawItemCount !== spotifyTotal) {
    return {
      spotifyTotal,
      pages,
      rawItemCount,
      localOrNullCount: input.localOrNullCount,
      usableTrackCount: input.usableTrackCount,
      complete: false,
      reason: `Raw saved-track items ${rawItemCount} !== Spotify total ${spotifyTotal}`,
    };
  }
  if (input.usableTrackCount + input.localOrNullCount !== rawItemCount) {
    return {
      spotifyTotal,
      pages,
      rawItemCount,
      localOrNullCount: input.localOrNullCount,
      usableTrackCount: input.usableTrackCount,
      complete: false,
      reason: "Usable + local/null counts do not cover every raw saved-track item",
    };
  }
  return {
    spotifyTotal,
    pages,
    rawItemCount,
    localOrNullCount: input.localOrNullCount,
    usableTrackCount: input.usableTrackCount,
    complete: true,
    reason: "All Spotify saved-track pages consumed",
  };
}

export function canReplaceAuthoritativeLikedLibrary(audit: SavedTracksFetchAudit): boolean {
  return audit.complete;
}

export function isCompleteSavedTracksSummary(input: {
  spotifyTotal: number | null;
  rawItemCount: number;
  localOrNullCount: number;
  usableCount: number;
  stoppedEarly?: boolean;
}): { complete: boolean; reason: string } {
  if (input.stoppedEarly) {
    return { complete: false, reason: "Fetch stopped before consuming every saved-track page" };
  }
  if (input.spotifyTotal == null || !Number.isFinite(input.spotifyTotal)) {
    return { complete: false, reason: "Spotify total missing — fetch is not authoritative" };
  }
  if (input.rawItemCount !== input.spotifyTotal) {
    return {
      complete: false,
      reason: `Raw saved-track items ${input.rawItemCount} !== Spotify total ${input.spotifyTotal}`,
    };
  }
  if (input.usableCount + input.localOrNullCount !== input.rawItemCount) {
    return {
      complete: false,
      reason: "Usable + local/null counts do not cover every raw saved-track item",
    };
  }
  return { complete: true, reason: "All Spotify saved-track pages consumed" };
}

export type SnapshotAuthority = {
  source: "postgresql_liked_songs" | "file_snapshot" | "unknown";
  canClaimCurrentLibrary: boolean;
  reason: string;
};

export function snapshotAuthority(input: {
  dbAvailable: boolean;
  dbTrackCount: number | null;
  fileTrackCount: number | null;
  fileLoadedAt?: string | null;
  preferFileIfPresent?: boolean;
}): SnapshotAuthority {
  if (input.preferFileIfPresent && (input.fileTrackCount ?? 0) > 0 && input.dbAvailable) {
    return {
      source: "file_snapshot",
      canClaimCurrentLibrary: false,
      reason:
        "File snapshot would override PostgreSQL liked_songs. That file is historical, not current Spotify.",
    };
  }
  if (input.dbAvailable && (input.dbTrackCount ?? 0) > 0) {
    return {
      source: "postgresql_liked_songs",
      canClaimCurrentLibrary: true,
      reason: "PostgreSQL liked_songs is the generate-time library (derived from last successful Spotify sync).",
    };
  }
  if ((input.fileTrackCount ?? 0) > 0) {
    return {
      source: "file_snapshot",
      canClaimCurrentLibrary: false,
      reason: `File snapshot only (${input.fileLoadedAt ?? "unknown loadedAt"}). Cannot claim current Spotify library.`,
    };
  }
  return {
    source: "unknown",
    canClaimCurrentLibrary: false,
    reason: "No liked_songs rows and no snapshot file",
  };
}

export function incrementalSyncRemovesUnlikes(): boolean {
  return true;
}

export function unlikedTracksMustBeRemovedIfCacheClaimsCurrentLikes(): boolean {
  return true;
}

export function planLikedLibraryReconcile(
  dbIds: readonly string[],
  spotifyIds: readonly string[],
): { toInsert: string[]; toDelete: string[] } {
  const db = new Set(dbIds);
  const spotify = new Set(spotifyIds);
  const toInsert: string[] = [];
  const toDelete: string[] = [];
  for (const id of spotify) {
    if (!db.has(id)) toInsert.push(id);
  }
  for (const id of db) {
    if (!spotify.has(id)) toDelete.push(id);
  }
  return { toInsert, toDelete };
}

export function setDiffIds(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const id of left) {
    if (!right.has(id)) out.push(id);
  }
  return out;
}

export type ThreeWayClass = "111" | "110" | "101" | "011" | "100" | "010" | "001";

export function membershipClass(inCsv: boolean, inDb: boolean, inSpotify: boolean): ThreeWayClass {
  return `${inCsv ? "1" : "0"}${inDb ? "1" : "0"}${inSpotify ? "1" : "0"}` as ThreeWayClass;
}

export function threeWayMembershipCounts(
  csvIds: ReadonlySet<string>,
  dbIds: ReadonlySet<string>,
  spotifyIds: ReadonlySet<string>,
): Record<ThreeWayClass, number> & { universe: number } {
  const counts: Record<ThreeWayClass, number> = {
    "111": 0,
    "110": 0,
    "101": 0,
    "011": 0,
    "100": 0,
    "010": 0,
    "001": 0,
  };
  const universe = new Set<string>([...csvIds, ...dbIds, ...spotifyIds]);
  for (const id of universe) {
    counts[membershipClass(csvIds.has(id), dbIds.has(id), spotifyIds.has(id))] += 1;
  }
  return { ...counts, universe: universe.size };
}

export function uniqueIdCountIsAuthoritative(rawRows: number, uniqueIds: number, duplicateRows: number): boolean {
  return uniqueIds === rawRows - duplicateRows;
}
