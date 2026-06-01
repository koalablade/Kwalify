import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable, syncStatusTable } from "../db";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  fetchLikedSongs,
  fetchAudioFeatures,
  getValidAccessToken,
  getClientCredentialsToken,
  type SpotifyTrack,
} from "../lib/spotify";
import { logger } from "../lib/logger";
import {
  invalidateGenreProfileCache,
  warmGenreProfileCache,
} from "../lib/genre-profile-cache";
import { getFeatures } from "../lib/env";

const router: IRouter = Router();

export const activeSyncs = new Set<string>();

router.get("/spotify/cache-status", async (req, res): Promise<void> => {
  // Guard: Spotify must be configured for any sync-related endpoint to work.
  if (!getFeatures().spotify.enabled) {
    res.status(503).json({ error: "Spotify is not configured on this server." });
    return;
  }
  if (!req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;
  const [status] = await db
    .select()
    .from(syncStatusTable)
    .where(eq(syncStatusTable.spotifyUserId, userId));

  if (!status) {
    res.json({
      synced: false,
      totalTracks: 0,
      lastSyncedAt: null,
      isSyncing: activeSyncs.has(userId),
      syncProgress: null,
      syncTotal: null,
    });
    return;
  }

  let suggestFullSync = false;
  if (status.totalTracks >= 200) {
    const recentCutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));
    const [recentRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(likedSongsTable)
      .where(
        and(
          eq(likedSongsTable.spotifyUserId, userId),
          gt(likedSongsTable.addedAt, recentCutoff)
        )
      );
    const total = Number(totalRow?.count ?? 0);
    const recent = Number(recentRow?.count ?? 0);
    if (total > 0 && recent / total > 0.85) suggestFullSync = true;
  }

  res.json({
    synced: !!status.lastSyncedAt,
    totalTracks: status.totalTracks,
    lastSyncedAt: status.lastSyncedAt?.toISOString() ?? null,
    isSyncing: activeSyncs.has(userId) || status.isSyncing === 1,
    syncProgress: status.syncProgress ?? null,
    syncTotal: status.syncTotal ?? null,
    suggestFullSync,
  });
});

router.post("/spotify/sync", async (req, res): Promise<void> => {
  if (!getFeatures().spotify.enabled) {
    res.status(503).json({ error: "Spotify is not configured on this server." });
    return;
  }
  if (!req.session.spotifyTokens || !req.session.spotifyUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = req.session.spotifyUserId;

  if (activeSyncs.has(userId)) {
    res.json({ message: "Sync already in progress", started: false });
    return;
  }

  activeSyncs.add(userId);

  await db
    .insert(syncStatusTable)
    .values({ spotifyUserId: userId, isSyncing: 1, totalTracks: 0 })
    .onConflictDoUpdate({
      target: syncStatusTable.spotifyUserId,
      set: { isSyncing: 1, syncProgress: 0, updatedAt: new Date() },
    });

  const forceFull = req.body?.full === true;

  res.json({ message: forceFull ? "Full sync started" : "Sync started", started: true, full: forceFull });

  runSync(userId, req.session.spotifyTokens, { forceFull }).catch((err) => {
    logger.error({ err, userId }, "Background sync failed");
    activeSyncs.delete(userId);
  });
});

export async function runSync(
  userId: string,
  tokens: any,
  opts?: { forceFull?: boolean }
): Promise<void> {
  try {
    const freshTokens = await getValidAccessToken(tokens);
    const accessToken = freshTokens.accessToken;

    // Determine whether this is an incremental sync by checking lastSyncedAt
    const [existingStatus] = await db
      .select()
      .from(syncStatusTable)
      .where(eq(syncStatusTable.spotifyUserId, userId));

    const lastSyncedAt: Date | null =
      opts?.forceFull ? null : (existingStatus?.lastSyncedAt ?? null);
    const isIncremental = !!lastSyncedAt;

    let newTracks: SpotifyTrack[] = [];
    let grandTotal = 0;

    await fetchLikedSongs(
      accessToken,
      async (tracks, total, offset) => {
        newTracks.push(...tracks);
        grandTotal = total;

        const progressCount = isIncremental
          ? newTracks.length
          : offset + tracks.length;
        const progressTotal = isIncremental ? null : total;

        await db
          .update(syncStatusTable)
          .set({
            syncProgress: progressCount,
            syncTotal: progressTotal ?? total,
            // During incremental sync keep totalTracks as existing count until done
            totalTracks: isIncremental
              ? (existingStatus?.totalTracks ?? 0)
              : offset + tracks.length,
            updatedAt: new Date(),
          })
          .where(eq(syncStatusTable.spotifyUserId, userId));
      },
      // Pass the cutoff so fetchLikedSongs stops early on incremental runs
      lastSyncedAt ?? undefined
    );

    if (isIncremental) {
      logger.info(
        { userId, newTrackCount: newTracks.length, lastSyncedAt },
        `[sync] Incremental sync: found ${newTracks.length} new tracks since lastSyncedAt`
      );
    }

    const trackIds = newTracks.map((t) => t.id);

    // Use a server-level Client Credentials token for audio features so it has
    // its own quota bucket, independent of the user token that was already used
    // for liked-songs pages above.  Falls back to the user token if the CC
    // token request fails (e.g. missing env vars in local dev).
    let audioFeaturesToken = accessToken;
    try {
      audioFeaturesToken = await getClientCredentialsToken();
    } catch (err) {
      logger.warn({ err }, "Could not obtain CC token for audio features — using user token");
    }

    const allFeatures = trackIds.length > 0
      ? await fetchAudioFeatures(audioFeaturesToken, trackIds)
      : [];
    const featuresMap = new Map(allFeatures.map((f) => [f.id, f]));

    if (!isIncremental) {
      // Full sync: wipe and re-insert everything
      await db.delete(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, userId));
    }

    if (newTracks.length > 0) {
      const batchSize = 200;
      for (let i = 0; i < newTracks.length; i += batchSize) {
        const batch = newTracks.slice(i, i + batchSize);
        const rows = batch.map((track) => {
          const features = featuresMap.get(track.id);
          return {
            spotifyUserId: userId,
            trackId: track.id,
            trackName: track.name,
            artistName: track.artists[0]?.name ?? "Unknown",
            albumName: track.album.name,
            albumArt: track.album.images[0]?.url ?? null,
            durationMs: track.duration_ms,
            energy: features?.energy ?? null,
            valence: features?.valence ?? null,
            tempo: features?.tempo ?? null,
            danceability: features?.danceability ?? null,
            acousticness: features?.acousticness ?? null,
            instrumentalness: features?.instrumentalness ?? null,
            loudness: features?.loudness ?? null,
            speechiness: features?.speechiness ?? null,
            addedAt: track.addedAt ? new Date(track.addedAt) : new Date(),
          };
        });

        await db.insert(likedSongsTable).values(rows);
      }
    }

    const finalTotalTracks = isIncremental
      ? (existingStatus?.totalTracks ?? 0) + newTracks.length
      : newTracks.length;

    await db
      .update(syncStatusTable)
      .set({
        isSyncing: 0,
        totalTracks: finalTotalTracks,
        lastSyncedAt: new Date(),
        syncProgress: newTracks.length,
        syncTotal: grandTotal,
        updatedAt: new Date(),
      })
      .where(eq(syncStatusTable.spotifyUserId, userId));

    invalidateGenreProfileCache(userId);

    const allRows = await db
      .select()
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));
    warmGenreProfileCache(
      userId,
      allRows.map((s) => ({
        trackId: s.trackId,
        trackName: s.trackName,
        artistName: s.artistName,
        albumName: s.albumName,
        energy: s.energy,
        valence: s.valence,
        acousticness: s.acousticness,
        danceability: s.danceability,
        tempo: s.tempo,
        instrumentalness: s.instrumentalness,
        speechiness: s.speechiness,
      }))
    );

    logger.info(
      { userId, totalTracks: finalTotalTracks, newTracks: newTracks.length, isIncremental },
      "Sync complete"
    );
  } catch (err) {
    logger.error({ err, userId }, "Sync failed");

    await db
      .update(syncStatusTable)
      .set({ isSyncing: 0, updatedAt: new Date() })
      .where(eq(syncStatusTable.spotifyUserId, userId));
  } finally {
    activeSyncs.delete(userId);
  }
}

export default router;
