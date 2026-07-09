/**
 * Backfill NULL audio features for a user's liked_songs rows.
 * Spotify /audio-features first (user OAuth token); metadata inference when API is blocked.
 */

import { db, likedSongsTable } from "../db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { fetchAudioFeatures, getClientCredentialsToken } from "./spotify";
import { inferMetadataAudioFeatures } from "./metadata-audio-feature-inference";
import { invalidateLikedSongsCache } from "./liked-songs-cache";
import { logger } from "./logger";

const BATCH = Number.parseInt(process.env["AUDIO_BACKFILL_BATCH_SIZE"] ?? "100", 10);
/** 0 = run until no NULL features remain (capped at 200 batches for safety). */
const MAX_BATCHES = Number.parseInt(process.env["AUDIO_BACKFILL_MAX_BATCHES"] ?? "0", 10);
const HARD_BATCH_CAP = 200;

type BackfillRow = {
  trackId: string;
  trackName: string;
  artistName: string;
  albumName: string;
  spotifyArtistGenres: unknown;
  albumGenres: unknown;
  popularity: number | null;
  durationMs: number;
};

function featureUpdateFromSpotify(f: {
  energy: number;
  valence: number;
  tempo: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  loudness: number;
  speechiness: number;
}) {
  return {
    energy: f.energy,
    valence: f.valence,
    tempo: f.tempo,
    danceability: f.danceability,
    acousticness: f.acousticness,
    instrumentalness: f.instrumentalness,
    loudness: f.loudness,
    speechiness: f.speechiness,
  };
}

export async function backfillAudioFeaturesForUser(
  userId: string,
  accessToken: string,
): Promise<{ updated: number; remaining: number; inferred: number; spotify: number }> {
  let updated = 0;
  let inferred = 0;
  let spotify = 0;
  let batches = 0;

  let ccToken: string | undefined;
  try {
    ccToken = await getClientCredentialsToken();
  } catch {
    ccToken = undefined;
  }

  const batchLimit = MAX_BATCHES > 0 ? MAX_BATCHES : HARD_BATCH_CAP;

  for (; batches < batchLimit; batches += 1) {
    const rows = await db
      .select({
        trackId: likedSongsTable.trackId,
        trackName: likedSongsTable.trackName,
        artistName: likedSongsTable.artistName,
        albumName: likedSongsTable.albumName,
        spotifyArtistGenres: likedSongsTable.spotifyArtistGenres,
        albumGenres: likedSongsTable.albumGenres,
        popularity: likedSongsTable.popularity,
        durationMs: likedSongsTable.durationMs,
      })
      .from(likedSongsTable)
      .where(
        and(
          eq(likedSongsTable.spotifyUserId, userId),
          or(isNull(likedSongsTable.energy), isNull(likedSongsTable.valence)),
        ),
      )
      .limit(BATCH);
    if (rows.length === 0) break;

    const spotifyFeatures = await fetchAudioFeatures(
      accessToken,
      rows.map((r) => r.trackId),
      { fallbackToken: ccToken, userKey: userId },
    );
    const byId = new Map(spotifyFeatures.map((f) => [f.id, f]));

    for (const row of rows as BackfillRow[]) {
      let features = byId.get(row.trackId);
      let source: "spotify" | "inferred" = "spotify";
      if (!features) {
        features = inferMetadataAudioFeatures(row);
        source = "inferred";
      }

      await db
        .update(likedSongsTable)
        .set(featureUpdateFromSpotify(features))
        .where(
          and(
            eq(likedSongsTable.spotifyUserId, userId),
            eq(likedSongsTable.trackId, row.trackId),
          ),
        );
      updated += 1;
      if (source === "inferred") inferred += 1;
      else spotify += 1;
    }

    logger.info(
      { userId, batch: rows.length, updated, inferred, spotify, batchIndex: batches + 1 },
      "Audio feature backfill batch",
    );
  }

  const [remainingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(likedSongsTable)
    .where(
      and(
        eq(likedSongsTable.spotifyUserId, userId),
        or(isNull(likedSongsTable.energy), isNull(likedSongsTable.valence)),
      ),
    );

  const remaining = Number(remainingRow?.count ?? 0);
  if (updated > 0) invalidateLikedSongsCache(userId);

  return { updated, remaining, inferred, spotify };
}
