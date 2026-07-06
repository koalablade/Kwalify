import { db, likedSongsTable, syncStatusTable } from "../db";
import { eq, sql } from "drizzle-orm";
import { activeSyncs } from "./active-syncs";
import {
  computeSyncQualityScore,
  syncQualityLabel,
  type SyncQualityLabel,
} from "./sync-quality";

export interface LibrarySyncStatus {
  isSynced: boolean;
  isSyncing: boolean;
  /** 0–100 while syncing; 100 when synced; 0 when not started / failed */
  syncProgress: number;
  featureCoverage: number;
  lastSyncedAt: string | null;
  syncError: string | null;
  totalTracks: number;
  /** 0–100 informational quality score; does not gate generation */
  syncQualityScore: number;
  syncQualityLabel: SyncQualityLabel;
}

function progressPercent(
  syncProgress: number | null | undefined,
  syncTotal: number | null | undefined,
  isSyncing: boolean,
  isSynced: boolean
): number {
  if (isSynced) return 100;
  if (!isSyncing) return 0;
  if (syncTotal != null && syncTotal > 0 && syncProgress != null) {
    return Math.max(0, Math.min(100, Math.round((syncProgress / syncTotal) * 100)));
  }
  if (syncProgress != null && syncProgress > 0) {
    return Math.min(99, syncProgress);
  }
  return 0;
}

export async function getLibrarySyncStatus(userId: string): Promise<LibrarySyncStatus> {
  const [status] = await db
    .select()
    .from(syncStatusTable)
    .where(eq(syncStatusTable.spotifyUserId, userId));

  const isSyncing = activeSyncs.has(userId) || status?.isSyncing === 1;
  const totalTracks = status?.totalTracks ?? 0;
  const lastSyncedAt = status?.lastSyncedAt?.toISOString() ?? null;
  const syncError = status?.syncError ?? null;

  const syncCompletedSuccessfully =
    !isSyncing && lastSyncedAt !== null && syncError === null;

  const isSynced = syncCompletedSuccessfully;

  let featureCoverage = 0;
  if (totalTracks > 0) {
    const [row] = await db
      .select({
        withFeatures: sql<number>`count(*) filter (where ${likedSongsTable.energy} is not null and ${likedSongsTable.valence} is not null)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));
    const total = Number(row?.total ?? 0);
    const withFeatures = Number(row?.withFeatures ?? 0);
    featureCoverage =
      total > 0 ? Math.round((withFeatures / total) * 1000) / 10 : 0;
  }

  const syncQualityScore = computeSyncQualityScore({
    featureCoverage,
    totalTracks,
    syncTotal: status?.syncTotal,
    syncCompletedSuccessfully,
  });

  return {
    isSynced,
    isSyncing,
    syncProgress: progressPercent(
      status?.syncProgress,
      status?.syncTotal,
      isSyncing,
      isSynced
    ),
    featureCoverage,
    lastSyncedAt,
    syncError,
    totalTracks,
    syncQualityScore,
    syncQualityLabel: syncQualityLabel(syncQualityScore),
  };
}
