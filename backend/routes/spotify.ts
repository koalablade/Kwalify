/**
 * Purpose: Spotify library sync routes — cache status, incremental sync, full sync.
 * Responsibilities:
 *   - GET  /api/spotify/cache-status — report library sync state
 *   - POST /api/spotify/sync         — incremental or full liked-songs sync
 * Dependencies: spotify lib, drizzle-orm, pg (batch upserts)
 */
import { Router, type IRouter } from "express";
import { db } from "../db";
import { likedSongsTable, syncStatusTable } from "../db";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  fetchLikedSongs,
  fetchAudioFeatures,
  fetchArtistGenres,
  enrichTrackMetadata,
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
import { generateMockSpotifyLibrary } from "../lib/mock-spotify";

const router: IRouter = Router();

export const activeSyncs = new Set<string>();

router.get("/spotify/cache-status", async (req, res): Promise<void> => {
  if (getFeatures().devMode.useMockSpotify) {
    res.json({
      synced: true,
      totalTracks: generateMockSpotifyLibrary().length,
      lastSyncedAt: new Date().toISOString(),
      isSyncing: false,
      syncProgress: null,
      syncTotal: null,
      suggestFullSync: false,
      devMode: true,
    });
    return;
  }
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
  if (getFeatures().devMode.useMockSpotify) {
    res.json({
      message: "Mock Spotify library is generated on demand in dev mode.",
      started: false,
      devMode: true,
    });
    return;
  }
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

  const forceFull = req.body?.full === true;
  const [existingStatus] = await db
    .select()
    .from(syncStatusTable)
    .where(eq(syncStatusTable.spotifyUserId, userId));

  if (
    forceFull &&
    existingStatus?.lastSyncedAt &&
    (existingStatus.totalTracks ?? 0) >= 500
  ) {
    const hoursSince =
      (Date.now() - existingStatus.lastSyncedAt.getTime()) / (60 * 60 * 1000);
    if (hoursSince < 6) {
      res.json({
        message:
          "Library was synced recently. Use normal sync for new likes, or wait a few hours before another full sync.",
        started: false,
        skipped: true,
        reason: "FULL_SYNC_COOLDOWN",
      });
      return;
    }
  }

  activeSyncs.add(userId);

  await db
    .insert(syncStatusTable)
    .values({ spotifyUserId: userId, isSyncing: 1, totalTracks: 0 })
    .onConflictDoUpdate({
      target: syncStatusTable.spotifyUserId,
      set: { isSyncing: 1, syncProgress: 0, updatedAt: new Date() },
    });

  res.json({
    message: forceFull ? "Full sync started" : "Sync started",
    started: true,
    full: forceFull,
  });

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

    // Preserve audio features from DB before full sync wipe (Spotify often 403s bulk audio-features).
    const preservedFeatures = new Map<
      string,
      {
        energy: number | null;
        valence: number | null;
        tempo: number | null;
        danceability: number | null;
        acousticness: number | null;
        instrumentalness: number | null;
        loudness: number | null;
        speechiness: number | null;
      }
    >();
    if (!isIncremental) {
      const existingRows = await db
        .select()
        .from(likedSongsTable)
        .where(eq(likedSongsTable.spotifyUserId, userId));
      for (const row of existingRows) {
        if (row.energy != null || row.valence != null) {
          preservedFeatures.set(row.trackId, {
            energy: row.energy,
            valence: row.valence,
            tempo: row.tempo,
            danceability: row.danceability,
            acousticness: row.acousticness,
            instrumentalness: row.instrumentalness,
            loudness: row.loudness,
            speechiness: row.speechiness,
          });
        }
      }
    }

    const trackIds = newTracks.map((t) => t.id);
    const idsNeedingFeatures = trackIds.filter((id) => !preservedFeatures.has(id));

    let ccToken: string | undefined;
    try {
      ccToken = await getClientCredentialsToken();
    } catch (err) {
      logger.warn({ err }, "Could not obtain CC token for audio features — using user token only");
    }

    const allFeatures =
      idsNeedingFeatures.length > 0
        ? await fetchAudioFeatures(ccToken ?? accessToken, idsNeedingFeatures, {
            fallbackToken: accessToken,
            userKey: userId,
          })
        : [];
    const featuresMap = new Map(allFeatures.map((f) => [f.id, f]));

    for (const [trackId, preserved] of preservedFeatures) {
      if (!featuresMap.has(trackId)) {
        featuresMap.set(trackId, {
          id: trackId,
          energy: preserved.energy ?? 0.5,
          valence: preserved.valence ?? 0.5,
          tempo: preserved.tempo ?? 120,
          danceability: preserved.danceability ?? 0.5,
          acousticness: preserved.acousticness ?? 0.5,
          instrumentalness: preserved.instrumentalness ?? 0,
          loudness: preserved.loudness ?? -10,
          speechiness: preserved.speechiness ?? 0.05,
        });
      }
    }

    if (!isIncremental) {
      // Full sync: wipe and re-insert everything
      await db.delete(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, userId));
    }

    if (newTracks.length > 0) {
      let artistGenreMap = new Map<string, string[]>();
      try {
        artistGenreMap = await fetchArtistGenres(
          accessToken,
          newTracks.flatMap((track) => track.artists.map((artist) => artist.id).filter((id): id is string => !!id)),
          { userKey: userId }
        );
      } catch (err: any) {
        req.log.warn({ err: err?.message }, "Artist genre enrichment failed; continuing sync");
      }
      const batchSize = 200;
      for (let i = 0; i < newTracks.length; i += batchSize) {
        const batch = newTracks.slice(i, i + batchSize);
        const rows = batch.map((track) => {
          const enriched = enrichTrackMetadata(track, artistGenreMap);
          const features = featuresMap.get(track.id);
          return {
            spotifyUserId: userId,
            trackId: enriched.id,
            trackName: enriched.name,
            artistName: enriched.artists[0]?.name ?? "Unknown",
            albumName: enriched.album.name,
            albumArt: enriched.album.images[0]?.url ?? null,
            durationMs: enriched.duration_ms,
            energy: features?.energy ?? null,
            valence: features?.valence ?? null,
            tempo: features?.tempo ?? null,
            danceability: features?.danceability ?? null,
            acousticness: features?.acousticness ?? null,
            instrumentalness: features?.instrumentalness ?? null,
            loudness: features?.loudness ?? null,
            speechiness: features?.speechiness ?? null,
            spotifyArtistGenres: enriched.spotifyArtistGenres,
            albumGenres: enriched.albumGenres,
            popularity: enriched.popularity ?? null,
            releaseYear: enriched.releaseYear ?? null,
            addedAt: enriched.addedAt ? new Date(enriched.addedAt) : new Date(),
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

    const withFeatures = allRows.filter(
      (r) => r.energy != null && r.valence != null
    ).length;
    const featureCoverage =
      allRows.length > 0 ? withFeatures / allRows.length : 0;
    if (featureCoverage < 0.35 && allRows.length > 100) {
      logger.warn(
        { userId, featureCoverage, withFeatures, total: allRows.length },
        "Low audio-feature coverage — generation uses metadata and defaults"
      );
    }

    logger.info(
      {
        userId,
        totalTracks: finalTotalTracks,
        newTracks: newTracks.length,
        isIncremental,
        featureCoverage: Math.round(featureCoverage * 1000) / 1000,
      },
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
