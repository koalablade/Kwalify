import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable, syncStatusTable } from "../db";
import { eq } from "drizzle-orm";
import {
  fetchLikedSongs,
  fetchAudioFeatures,
  getValidAccessToken,
  type SpotifyTrack,
} from "../lib/spotify";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const activeSyncs = new Set<string>();

router.get("/spotify/cache-status", async (req, res): Promise<void> => {
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

  res.json({
    synced: !!status.lastSyncedAt,
    totalTracks: status.totalTracks,
    lastSyncedAt: status.lastSyncedAt?.toISOString() ?? null,
    isSyncing: activeSyncs.has(userId) || status.isSyncing === 1,
    syncProgress: status.syncProgress ?? null,
    syncTotal: status.syncTotal ?? null,
  });
});

router.post("/spotify/sync", async (req, res): Promise<void> => {
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

  res.json({ message: "Sync started", started: true });

  runSync(userId, req.session.spotifyTokens).catch((err) => {
    logger.error({ err, userId }, "Background sync failed");
    activeSyncs.delete(userId);
  });
});

async function runSync(userId: string, tokens: any): Promise<void> {
  try {
    const freshTokens = await getValidAccessToken(tokens);
    const accessToken = freshTokens.accessToken;

    let allTracks: SpotifyTrack[] = [];
    let grandTotal = 0;

    await fetchLikedSongs(accessToken, async (tracks, total, offset) => {
      allTracks.push(...tracks);
      grandTotal = total;

      await db
        .update(syncStatusTable)
        .set({
          syncProgress: offset + tracks.length,
          syncTotal: total,
          totalTracks: offset + tracks.length,
          updatedAt: new Date(),
        })
        .where(eq(syncStatusTable.spotifyUserId, userId));
    });

    const trackIds = allTracks.map((t) => t.id);
    const allFeatures = await fetchAudioFeatures(accessToken, trackIds);
    const featuresMap = new Map(allFeatures.map((f) => [f.id, f]));

    await db.delete(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, userId));

    const batchSize = 200;
    for (let i = 0; i < allTracks.length; i += batchSize) {
      const batch = allTracks.slice(i, i + batchSize);
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
          addedAt: new Date(),
        };
      });

      await db.insert(likedSongsTable).values(rows);
    }

    await db
      .update(syncStatusTable)
      .set({
        isSyncing: 0,
        totalTracks: allTracks.length,
        lastSyncedAt: new Date(),
        syncProgress: allTracks.length,
        syncTotal: grandTotal,
        updatedAt: new Date(),
      })
      .where(eq(syncStatusTable.spotifyUserId, userId));

    logger.info({ userId, totalTracks: allTracks.length }, "Sync complete");
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
