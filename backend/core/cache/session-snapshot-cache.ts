/**
 * Per-session generation snapshot cache.
 *
 * This keeps expensive, request-local hydration data warm for a short window
 * without changing database ownership or persisted schema.
 */

const DEFAULT_SESSION_SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const MAX_SESSION_SNAPSHOTS = 500;

export type SessionSnapshotCacheStats = {
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
  partialSnapshots: number;
};

export type SessionSnapshot<TLikedSongRow = unknown, TPlaylistHistoryRow = unknown, TFeedbackMemory = unknown> = {
  userId: string;
  sessionId: string;
  version: "sessionSnapshotV1";
  likedSongs: TLikedSongRow[];
  recentPlaylists: TPlaylistHistoryRow[];
  feedbackMemory: TFeedbackMemory;
  updatedAt: number;
};

type SnapshotEntry = {
  snapshot: SessionSnapshot;
  expiresAt: number;
};

const snapshots = new Map<string, SnapshotEntry>();
const stats: SessionSnapshotCacheStats = {
  hits: 0,
  misses: 0,
  writes: 0,
  evictions: 0,
  partialSnapshots: 0,
};

function ttlMs(): number {
  const configured = Number.parseInt(process.env["SESSION_SNAPSHOT_CACHE_TTL_MS"] ?? "", 10);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SESSION_SNAPSHOT_TTL_MS;
}

export function sessionSnapshotKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}:sessionSnapshotV1`;
}

function evictExpired(now = Date.now()): void {
  for (const [key, entry] of snapshots.entries()) {
    if (entry.expiresAt > now) continue;
    snapshots.delete(key);
    stats.evictions += 1;
  }
}

function evictOldestIfNeeded(): void {
  while (snapshots.size > MAX_SESSION_SNAPSHOTS) {
    const oldestKey = snapshots.keys().next().value as string | undefined;
    if (!oldestKey) return;
    snapshots.delete(oldestKey);
    stats.evictions += 1;
  }
}

function isCompleteSnapshot(snapshot: SessionSnapshot): boolean {
  return Array.isArray(snapshot.likedSongs) &&
    Array.isArray(snapshot.recentPlaylists) &&
    snapshot.feedbackMemory !== undefined &&
    snapshot.feedbackMemory !== null;
}

export function getSessionSnapshot<TLikedSongRow = unknown, TPlaylistHistoryRow = unknown, TFeedbackMemory = unknown>(
  userId: string,
  sessionId: string,
): SessionSnapshot<TLikedSongRow, TPlaylistHistoryRow, TFeedbackMemory> | null {
  const now = Date.now();
  evictExpired(now);
  const key = sessionSnapshotKey(userId, sessionId);
  const entry = snapshots.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (entry) {
      snapshots.delete(key);
      stats.evictions += 1;
    }
    stats.misses += 1;
    return null;
  }
  if (!isCompleteSnapshot(entry.snapshot)) {
    snapshots.delete(key);
    stats.partialSnapshots += 1;
    stats.misses += 1;
    console.warn("PARTIAL_SNAPSHOT_DETECTED", { userId, sessionId });
    return null;
  }
  stats.hits += 1;
  return entry.snapshot as SessionSnapshot<TLikedSongRow, TPlaylistHistoryRow, TFeedbackMemory>;
}

export function mergeSessionSnapshot<TLikedSongRow = unknown, TPlaylistHistoryRow = unknown, TFeedbackMemory = unknown>(
  userId: string,
  sessionId: string,
  snapshotData: Pick<SessionSnapshot<TLikedSongRow, TPlaylistHistoryRow, TFeedbackMemory>, "likedSongs" | "recentPlaylists" | "feedbackMemory">,
): SessionSnapshot<TLikedSongRow, TPlaylistHistoryRow, TFeedbackMemory> {
  const key = sessionSnapshotKey(userId, sessionId);
  const snapshot: SessionSnapshot<TLikedSongRow, TPlaylistHistoryRow, TFeedbackMemory> = {
    userId,
    sessionId,
    version: "sessionSnapshotV1",
    likedSongs: snapshotData.likedSongs,
    recentPlaylists: snapshotData.recentPlaylists,
    feedbackMemory: snapshotData.feedbackMemory,
    updatedAt: Date.now(),
  };
  if (!isCompleteSnapshot(snapshot as SessionSnapshot)) {
    stats.partialSnapshots += 1;
    console.warn("PARTIAL_SNAPSHOT_DETECTED", { userId, sessionId });
    throw new Error("PARTIAL_SNAPSHOT_DETECTED");
  }
  snapshots.set(key, {
    snapshot: snapshot as SessionSnapshot,
    expiresAt: Date.now() + ttlMs(),
  });
  stats.writes += 1;
  evictOldestIfNeeded();
  return snapshot;
}

export function clearSessionSnapshot(userId: string, sessionId: string): void {
  snapshots.delete(sessionSnapshotKey(userId, sessionId));
}

export function clearAllSessionSnapshots(): void {
  snapshots.clear();
}

export function getSessionSnapshotCacheStats(): SessionSnapshotCacheStats {
  return { ...stats };
}
