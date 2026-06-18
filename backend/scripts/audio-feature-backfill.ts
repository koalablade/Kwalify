/**
 * Backfill NULL audio features on liked_songs rows.
 *
 * Usage:
 *   SPOTIFY_ACCESS_TOKEN=... node backend/dist/scripts/audio-feature-backfill.js <spotify_user_id>
 */

import { db, likedSongsTable } from "../db";
import { sql } from "drizzle-orm";
import { fetchAudioFeatures } from "../lib/spotify";
import { logger } from "../lib/logger";

const BATCH = 100;

async function main(): Promise<void> {
  const userId = process.argv[2];
  const accessToken = process.env["SPOTIFY_ACCESS_TOKEN"];
  if (!userId || !accessToken) {
    console.error("Usage: SPOTIFY_ACCESS_TOKEN=... node audio-feature-backfill.js <spotify_user_id>");
    process.exit(2);
  }

  let updated = 0;
  for (;;) {
    const rows = await db
      .select({ trackId: likedSongsTable.trackId })
      .from(likedSongsTable)
      .where(
        sql`${likedSongsTable.spotifyUserId} = ${userId} AND (${likedSongsTable.energy} IS NULL OR ${likedSongsTable.valence} IS NULL)`,
      )
      .limit(BATCH);
    if (rows.length === 0) break;

    const features = await fetchAudioFeatures(
      accessToken,
      rows.map((r) => r.trackId),
      { userKey: userId },
    );
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
          sql`${likedSongsTable.spotifyUserId} = ${userId} AND ${likedSongsTable.trackId} = ${row.trackId}`,
        );
      updated += 1;
    }
    logger.info({ userId, batch: rows.length, updated }, "Audio feature backfill batch");
  }
  console.log(JSON.stringify({ userId, updated }));
}

main().catch((err) => {
  logger.error({ err }, "Audio feature backfill failed");
  process.exit(1);
});
