/**
 * Backfill NULL audio features for a user's liked_songs rows.
 * Called post-sync and on a slow server-side schedule when access token is available.
 */

import { db, likedSongsTable } from "../db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { fetchAudioFeatures, getClientCredentialsToken } from "./spotify";
import { logger } from "./logger";

const BATCH = Number.parseInt(process.env["AUDIO_BACKFILL_BATCH_SIZE"] ?? "100", 10);
const MAX_BATCHES = Number.parseInt(process.env["AUDIO_BACKFILL_MAX_BATCHES"] ?? "20", 10);

export async function backfillAudioFeaturesForUser(
  userId: string,
  accessToken: string,
): Promise<{ updated: number; remaining: number }> {
  let updated = 0;
  let batches = 0;

  let ccToken: string | undefined;
  try {
    ccToken = await getClientCredentialsToken();
  } catch {
    ccToken = undefined;
  }

  for (; batches < MAX_BATCHES; batches += 1) {
    const rows = await db
      .select({ trackId: likedSongsTable.trackId })
      .from(likedSongsTable)
      .where(
        and(
          eq(likedSongsTable.spotifyUserId, userId),
          or(isNull(likedSongsTable.energy), isNull(likedSongsTable.valence)),
        ),
      )
      .limit(BATCH);
    if (rows.length === 0) break;

    const features = await fetchAudioFeatures(ccToken ?? accessToken, rows.map((r) => r.trackId), {
      fallbackToken: accessToken,
      userKey: userId,
    });
    const byId = new Map(features.map((f) => [f.id, f]));

    for (const row of rows) {
      const f = byId.get(row.trackId);
      if (!f) continue;
      await db
        .update(likedSongsTable)
        .set({
          energy: f.energy,
          valence: f.valence,
          tempo: f.tempo,
          danceability: f.danceability,
          acousticness: f.acousticness,
          instrumentalness: f.instrumentalness,
          loudness: f.loudness,
          speechiness: f.speechiness,
        })
        .where(
          and(
            eq(likedSongsTable.spotifyUserId, userId),
            eq(likedSongsTable.trackId, row.trackId),
          ),
        );
      updated += 1;
    }
    logger.info({ userId, batch: rows.length, updated, batchIndex: batches + 1 }, "Audio feature backfill batch");
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

  return { updated, remaining: Number(remainingRow?.count ?? 0) };
}
