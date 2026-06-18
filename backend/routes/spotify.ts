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
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import {
  fetchLikedSongs,
  fetchAudioFeatures,
  fetchAlbumMetadata,
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
import { invalidateLikedSongsCache, setCachedLikedSongs } from "../lib/liked-songs-cache";
import { invalidateGenerateResultCache } from "../lib/generate-result-cache";
import { enrichTrackSemanticProfile } from "../lib/track-semantic-enrichment";
import { SEMANTIC_ENRICHMENT_VERSION } from "../lib/track-semantic-types";
import { enrichLibrarySemanticProfiles } from "../lib/semantic-enrichment-pipeline";
import { backfillAudioFeaturesForUser } from "../lib/audio-feature-backfill-job";
import { recordSyncFailure } from "../lib/ops-metrics";
import { invalidateSemanticProfileCache } from "../lib/semantic-profile-store";
import { getFeatures } from "../lib/env";
import { generateMockSpotifyLibrary } from "../lib/mock-spotify";

const router: IRouter = Router();

export const activeSyncs = new Set<string>();
const STALE_SYNC_MS = 45 * 60 * 1000;
const FULL_SYNC_COOLDOWN_HOURS = 6;

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

  if (
    status?.isSyncing === 1 &&
    !activeSyncs.has(userId) &&
    Date.now() - status.updatedAt.getTime() > STALE_SYNC_MS
  ) {
    await db
      .update(syncStatusTable)
      .set({ isSyncing: 0, updatedAt: new Date() })
      .where(eq(syncStatusTable.spotifyUserId, userId));
    status.isSyncing = 0;
    logger.warn({ userId }, "Cleared stale Spotify sync flag");
  }

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
  const [liveCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(likedSongsTable)
    .where(eq(likedSongsTable.spotifyUserId, userId));
  const liveTotalTracks = Number(liveCountRow?.count ?? status.totalTracks);
  if (Math.abs(liveTotalTracks - status.totalTracks) > Math.max(5, status.totalTracks * 0.02)) {
    suggestFullSync = true;
  }
  if (status.totalTracks >= 200) {
    const recentCutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const total = liveTotalTracks;
    const [recentRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(likedSongsTable)
      .where(
        and(
          eq(likedSongsTable.spotifyUserId, userId),
          gt(likedSongsTable.addedAt, recentCutoff)
        )
      );
    const recent = Number(recentRow?.count ?? 0);
    if (total > 0 && recent / total > 0.85) suggestFullSync = true;
    const [metadataRow] = await db
      .select({
        withFeatures: sql<number>`count(*) filter (where energy is not null and valence is not null)::int`,
        withSpotifyGenres: sql<number>`count(*) filter (where spotify_artist_genres is not null)::int`,
      })
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));
    const featureCoverage = total > 0 ? Number(metadataRow?.withFeatures ?? 0) / total : 0;
    const spotifyGenreCoverage = total > 0 ? Number(metadataRow?.withSpotifyGenres ?? 0) / total : 0;
    if (featureCoverage < 0.35 || spotifyGenreCoverage < 0.35) suggestFullSync = true;
  }

  res.json({
    synced: !!status.lastSyncedAt,
    totalTracks: liveTotalTracks,
    storedTotalTracks: status.totalTracks,
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

  const forceFull = req.body?.full === true || req.query["full"] === "1";
  const [existingStatus] = await db
    .select()
    .from(syncStatusTable)
    .where(eq(syncStatusTable.spotifyUserId, userId));

  if (forceFull && existingStatus?.lastSyncedAt) {
    const [metadataRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        withFeatures: sql<number>`count(*) filter (where energy is not null and valence is not null)::int`,
        withSpotifyGenres: sql<number>`count(*) filter (where spotify_artist_genres is not null)::int`,
      })
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));
    const total = Number(metadataRow?.total ?? 0);
    const featureCoverage = total > 0 ? Number(metadataRow?.withFeatures ?? 0) / total : 0;
    const spotifyGenreCoverage = total > 0 ? Number(metadataRow?.withSpotifyGenres ?? 0) / total : 0;
    const metadataRepairNeeded = featureCoverage < 0.35 || spotifyGenreCoverage < 0.35;
    const hoursSince =
      (Date.now() - existingStatus.lastSyncedAt.getTime()) / (60 * 60 * 1000);
    if (hoursSince < FULL_SYNC_COOLDOWN_HOURS && !metadataRepairNeeded) {
      res.json({
        message:
          `Library was synced recently. Use normal sync for new likes, or wait ${FULL_SYNC_COOLDOWN_HOURS} hours between full syncs.`,
        started: false,
        skipped: true,
        reason: "FULL_SYNC_COOLDOWN",
        retryAfterHours: Math.max(0, Math.ceil(FULL_SYNC_COOLDOWN_HOURS - hoursSince)),
      });
      return;
    }
  }

  try {
    activeSyncs.add(userId);
    await db
      .insert(syncStatusTable)
      .values({ spotifyUserId: userId, isSyncing: 1, totalTracks: 0 })
      .onConflictDoUpdate({
        target: syncStatusTable.spotifyUserId,
        set: { isSyncing: 1, syncProgress: 0, updatedAt: new Date() },
      });
  } catch (err) {
    activeSyncs.delete(userId);
    logger.error({ err, userId }, "Failed to start Spotify sync");
    res.status(500).json({
      error: "Failed to start sync. Please try again shortly.",
      started: false,
    });
    return;
  }

  res.json({
    message: forceFull ? "Full sync started" : "Sync started",
    started: true,
    full: forceFull,
  });

  runSync(userId, req.session.spotifyTokens, { forceFull }).catch((err) => {
    recordSyncFailure({ userId, phase: "sync_start", message: err instanceof Error ? err.message : String(err) });
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
            totalTracks: isIncremental
              ? Number(
                  (
                    await db
                      .select({ count: sql<number>`count(*)::int` })
                      .from(likedSongsTable)
                      .where(eq(likedSongsTable.spotifyUserId, userId))
                  )[0]?.count ?? existingStatus?.totalTracks ?? 0,
                )
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
    newTracks = [...new Map(newTracks.map((track) => [track.id, track])).values()];

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

    const rowsToInsert: Array<typeof likedSongsTable.$inferInsert> = [];
    if (newTracks.length > 0) {
      let artistGenreMap = new Map<string, string[]>();
      let albumMetadataMap = new Map<string, { genres: string[]; releaseYear: number | null }>();
      try {
        artistGenreMap = await fetchArtistGenres(
          accessToken,
          newTracks.flatMap((track) => track.artists.map((artist) => artist.id).filter((id): id is string => !!id)),
          { userKey: userId }
        );
      } catch (err: any) {
        logger.warn({ err, status: err?.response?.status }, "Artist genre enrichment failed; continuing sync");
      }
      try {
        albumMetadataMap = await fetchAlbumMetadata(
          accessToken,
          newTracks.map((track) => track.album.id).filter((id): id is string => !!id),
          { userKey: userId }
        );
      } catch (err: any) {
        logger.warn({ err, status: err?.response?.status }, "Album metadata enrichment failed; continuing sync");
      }
      for (const track of newTracks) {
        const enriched = enrichTrackMetadata(track, artistGenreMap, albumMetadataMap);
        const features = featuresMap.get(track.id);
        const artistIds = enriched.artists.map((artist) => artist.id).filter((id): id is string => !!id);
        const semanticInput = {
          trackId: enriched.id,
          trackName: enriched.name,
          artistName: enriched.artists[0]?.name ?? "Unknown",
          albumName: enriched.album.name,
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
          releaseYear: enriched.releaseYear ?? null,
          popularity: enriched.popularity ?? null,
          primaryArtistId: artistIds[0] ?? null,
          artistIds,
        };
        const semanticProfile = enrichTrackSemanticProfile(semanticInput);
        rowsToInsert.push({
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
          primaryArtistId: artistIds[0] ?? null,
          artistIds,
          semanticProfile: semanticProfile as unknown as Record<string, unknown>,
          enrichmentVersion: SEMANTIC_ENRICHMENT_VERSION,
          enrichedAt: new Date(),
          addedAt: enriched.addedAt ? new Date(enriched.addedAt) : new Date(),
        });
      }
    }

    await db.transaction(async (tx) => {
      if (!isIncremental) {
        await tx.delete(likedSongsTable).where(eq(likedSongsTable.spotifyUserId, userId));
      } else if (rowsToInsert.length > 0) {
        const trackIds = rowsToInsert.map((row) => row.trackId);
        const deleteBatchSize = 500;
        for (let i = 0; i < trackIds.length; i += deleteBatchSize) {
          await tx
            .delete(likedSongsTable)
            .where(
              and(
                eq(likedSongsTable.spotifyUserId, userId),
                inArray(likedSongsTable.trackId, trackIds.slice(i, i + deleteBatchSize))
              )
            );
        }
      }

      const batchSize = 200;
      for (let i = 0; i < rowsToInsert.length; i += batchSize) {
        await tx.insert(likedSongsTable).values(rowsToInsert.slice(i, i + batchSize));
      }

      const [totalRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(likedSongsTable)
        .where(eq(likedSongsTable.spotifyUserId, userId));
      const finalTotalTracks = Number(totalRow?.count ?? rowsToInsert.length);

      await tx
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
    });

    invalidateGenreProfileCache(userId);
    invalidateLikedSongsCache(userId);
    invalidateGenerateResultCache(userId);
    invalidateSemanticProfileCache(userId);

    const allRows = await db
      .select()
      .from(likedSongsTable)
      .where(eq(likedSongsTable.spotifyUserId, userId));
    setCachedLikedSongs(userId, allRows);
    warmGenreProfileCache(
      userId,
      allRows.map((s) => ({
        trackId: s.trackId,
        trackName: s.trackName,
        artistName: s.artistName,
        albumName: s.albumName,
        spotifyArtistGenres: s.spotifyArtistGenres,
        albumGenres: s.albumGenres,
        energy: s.energy,
        valence: s.valence,
        acousticness: s.acousticness,
        danceability: s.danceability,
        tempo: s.tempo,
        instrumentalness: s.instrumentalness,
        speechiness: s.speechiness,
      }))
    );

    try {
      const enrichmentRows = allRows.map((s) => ({
        trackId: s.trackId,
        trackName: s.trackName,
        artistName: s.artistName,
        albumName: s.albumName,
        energy: s.energy,
        valence: s.valence,
        tempo: s.tempo,
        danceability: s.danceability,
        acousticness: s.acousticness,
        instrumentalness: s.instrumentalness,
        speechiness: s.speechiness,
        loudness: s.loudness,
        spotifyArtistGenres: s.spotifyArtistGenres,
        albumGenres: s.albumGenres,
        releaseYear: s.releaseYear,
        popularity: s.popularity,
        semanticProfile: s.semanticProfile,
        primaryArtistId: s.primaryArtistId,
        artistIds: Array.isArray(s.artistIds) ? s.artistIds.filter((id): id is string => typeof id === "string") : null,
      }));
      const enrichmentResult = await enrichLibrarySemanticProfiles(userId, enrichmentRows);
      logger.info({ userId, ...enrichmentResult }, "Semantic library enrichment complete");
    } catch (err) {
      logger.warn({ err, userId }, "Post-sync semantic enrichment failed — generation will enrich on demand");
    }

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

    if (featureCoverage < 1) {
      try {
        const backfill = await backfillAudioFeaturesForUser(userId, accessToken);
        if (backfill.updated > 0) {
          logger.info({ userId, ...backfill }, "Post-sync audio feature backfill complete");
        }
      } catch (err) {
        logger.warn({ err, userId }, "Post-sync audio feature backfill skipped");
      }
    }

    logger.info(
      {
        userId,
        totalTracks: allRows.length,
        newTracks: newTracks.length,
        isIncremental,
        featureCoverage: Math.round(featureCoverage * 1000) / 1000,
      },
      "Sync complete"
    );
  } catch (err) {
    recordSyncFailure({ userId, phase: "sync_run", message: err instanceof Error ? err.message : String(err) });
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
