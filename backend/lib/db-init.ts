import pg from "pg";
import { logger } from "./logger";
import { generateShareSlug } from "./share-slug";

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS "liked_songs" (
  "id" serial PRIMARY KEY,
  "spotify_user_id" text NOT NULL,
  "track_id" text NOT NULL,
  "track_name" text NOT NULL,
  "artist_name" text NOT NULL,
  "album_name" text NOT NULL,
  "album_art" text,
  "duration_ms" integer NOT NULL,
  "energy" real,
  "valence" real,
  "tempo" real,
  "danceability" real,
  "acousticness" real,
  "instrumentalness" real,
  "loudness" real,
  "speechiness" real,
  "spotify_artist_genres" jsonb,
  "album_genres" jsonb,
  "popularity" integer,
  "release_year" integer,
  "added_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_liked_songs_user" ON "liked_songs" ("spotify_user_id");
CREATE INDEX IF NOT EXISTS "IDX_liked_songs_user_added"
  ON "liked_songs" ("spotify_user_id", "added_at" DESC);
DELETE FROM "liked_songs" newer
USING "liked_songs" older
WHERE newer."spotify_user_id" = older."spotify_user_id"
  AND newer."track_id" = older."track_id"
  AND newer."id" > older."id";
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_liked_songs_user_track"
  ON "liked_songs" ("spotify_user_id", "track_id");
ALTER TABLE "liked_songs" ADD COLUMN IF NOT EXISTS "spotify_artist_genres" jsonb;
ALTER TABLE "liked_songs" ADD COLUMN IF NOT EXISTS "album_genres" jsonb;
ALTER TABLE "liked_songs" ADD COLUMN IF NOT EXISTS "popularity" integer;
ALTER TABLE "liked_songs" ADD COLUMN IF NOT EXISTS "release_year" integer;

CREATE TABLE IF NOT EXISTS "sync_status" (
  "id" serial PRIMARY KEY,
  "spotify_user_id" text NOT NULL UNIQUE,
  "total_tracks" integer NOT NULL DEFAULT 0,
  "is_syncing" integer NOT NULL DEFAULT 0,
  "sync_progress" integer,
  "sync_total" integer,
  "last_synced_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_sync_status_user" ON "sync_status" ("spotify_user_id");

CREATE TABLE IF NOT EXISTS "playlist_history" (
  "id" serial PRIMARY KEY,
  "spotify_user_id" text NOT NULL,
  "playlist_id" text NOT NULL,
  "playlist_url" text NOT NULL,
  "name" text NOT NULL,
  "vibe" text NOT NULL,
  "mode" text NOT NULL,
  "track_count" integer NOT NULL,
  "emotion_profile" jsonb,
  "track_ids" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_playlist_history_user" ON "playlist_history" ("spotify_user_id");
CREATE INDEX IF NOT EXISTS "IDX_playlist_history_user_created"
  ON "playlist_history" ("spotify_user_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "saved_playlists" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "emotion_profile" jsonb,
  "tracks" jsonb,
  "spotify_url" text,
  "vibe" text,
  "mode" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_saved_playlists_user" ON "saved_playlists" ("user_id");
CREATE INDEX IF NOT EXISTS "IDX_saved_playlists_user_created"
  ON "saved_playlists" ("user_id", "created_at" DESC);

ALTER TABLE "saved_playlists" ADD COLUMN IF NOT EXISTS "spotify_url" text;
ALTER TABLE "saved_playlists" ADD COLUMN IF NOT EXISTS "vibe" text;
ALTER TABLE "saved_playlists" ADD COLUMN IF NOT EXISTS "mode" text;
ALTER TABLE "saved_playlists" ADD COLUMN IF NOT EXISTS "share_slug" text;
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_saved_playlists_share_slug"
  ON "saved_playlists" ("share_slug")
  WHERE "share_slug" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "playlist_feedback" (
  "id" serial PRIMARY KEY,
  "playlist_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "vibe" text NOT NULL,
  "reaction" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_playlist_feedback_pl_user"
  ON "playlist_feedback" ("playlist_id", "user_id");

CREATE TABLE IF NOT EXISTS "user_feedback_memory" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL UNIQUE,
  "bad_artists" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "bad_genres" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "bad_energy_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "bad_mood_matches" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "bad_bridges" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "overplayed_tracks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "skip_count_by_track" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "save_count_by_track" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "artist_affinity_graph" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "album_affinity_graph" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "scene_embeddings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "user_feedback_memory"
  ADD COLUMN IF NOT EXISTS "artist_affinity_graph" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "album_affinity_graph" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "scene_embeddings" jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_feedback_memory_user"
  ON "user_feedback_memory" ("user_id");
`;

async function backfillShareSlugs(rawPool: pg.Pool): Promise<void> {
  for (;;) {
    const { rows } = await rawPool.query<{ id: number }>(
      `SELECT id FROM saved_playlists WHERE share_slug IS NULL LIMIT 100`,
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      let updated = false;
      for (let attempt = 0; attempt < 8 && !updated; attempt++) {
        const slug = generateShareSlug();
        try {
          const result = await rawPool.query(
            `UPDATE saved_playlists SET share_slug = $1 WHERE id = $2 AND share_slug IS NULL`,
            [slug, row.id],
          );
          updated = result.rowCount === 1;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code !== "23505") throw err;
        }
      }
      if (!updated) {
        throw new Error(`[db-init] Failed to assign share_slug for playlist ${row.id}`);
      }
    }
  }
}

export async function runDbInit(rawPool: pg.Pool): Promise<void> {
  try {
    await rawPool.query(SCHEMA_DDL);
    await backfillShareSlugs(rawPool);
    logger.info("[db-init] schema verified — all tables ready");
  } catch (err) {
    throw new Error(`[db-init] Schema bootstrap failed: ${(err as Error).message}`);
  }
}
