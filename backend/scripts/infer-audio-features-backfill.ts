/**
 * Backfill NULL audio features using metadata inference only (no Spotify token).
 *
 * Usage:
 *   node backend/dist/scripts/infer-audio-features-backfill.js <spotify_user_id>
 */

import { readFileSync } from "node:fs";
import pg from "pg";
import { inferMetadataAudioFeatures } from "../lib/metadata-audio-feature-inference";
import { logger } from "../lib/logger";

const BATCH = Number.parseInt(process.env["AUDIO_BACKFILL_BATCH_SIZE"] ?? "200", 10);

function loadDatabaseUrl(): string {
  const env = readFileSync(".env", "utf8");
  const match = env.match(/^DATABASE_URL=(.+)$/m);
  if (!match) throw new Error("DATABASE_URL missing in .env");
  return match[1].trim().replace(/^"|"$/g, "");
}

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Usage: node infer-audio-features-backfill.js <spotify_user_id>");
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString: loadDatabaseUrl() });
  let updated = 0;

  try {
    for (;;) {
      const { rows } = await pool.query<{
        track_id: string;
        track_name: string;
        artist_name: string;
        album_name: string;
        spotify_artist_genres: unknown;
        album_genres: unknown;
        popularity: number | null;
        duration_ms: number;
      }>(
        `SELECT track_id, track_name, artist_name, album_name, spotify_artist_genres, album_genres, popularity, duration_ms
         FROM liked_songs
         WHERE spotify_user_id = $1 AND (energy IS NULL OR valence IS NULL)
         LIMIT $2`,
        [userId, BATCH],
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        const features = inferMetadataAudioFeatures({
          trackId: row.track_id,
          trackName: row.track_name,
          artistName: row.artist_name,
          albumName: row.album_name,
          spotifyArtistGenres: row.spotify_artist_genres,
          albumGenres: row.album_genres,
          popularity: row.popularity,
          durationMs: row.duration_ms,
        });
        await pool.query(
          `UPDATE liked_songs
           SET energy = $3, valence = $4, tempo = $5, danceability = $6,
               acousticness = $7, instrumentalness = $8, loudness = $9, speechiness = $10
           WHERE spotify_user_id = $1 AND track_id = $2`,
          [
            userId,
            row.track_id,
            features.energy,
            features.valence,
            features.tempo,
            features.danceability,
            features.acousticness,
            features.instrumentalness,
            features.loudness,
            features.speechiness,
          ],
        );
        updated += 1;
      }
      logger.info({ userId, batch: rows.length, updated }, "Metadata audio feature backfill batch");
    }

    const [totals, withFeatures, remaining] = await Promise.all([
      pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM liked_songs WHERE spotify_user_id = $1", [userId]),
      pool.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM liked_songs WHERE spotify_user_id = $1 AND energy IS NOT NULL AND valence IS NOT NULL",
        [userId],
      ),
      pool.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM liked_songs WHERE spotify_user_id = $1 AND (energy IS NULL OR valence IS NULL)",
        [userId],
      ),
    ]);

    console.log(
      JSON.stringify({
        userId,
        updated,
        remaining: remaining.rows[0]?.n ?? 0,
        totalTracks: totals.rows[0]?.n ?? 0,
        withAudioFeatures: withFeatures.rows[0]?.n ?? 0,
        gymRelaxedGate: (
          await pool.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM liked_songs WHERE spotify_user_id = $1
             AND (energy >= 0.52 OR tempo >= 105 OR danceability >= 0.54)`,
            [userId],
          )
        ).rows[0]?.n ?? 0,
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error({ err }, "Metadata audio feature backfill failed");
  process.exit(1);
});
