import pg from "pg";
import { logger } from "./logger";

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
  "added_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_liked_songs_user" ON "liked_songs" ("spotify_user_id");

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

ALTER TABLE "saved_playlists" ADD COLUMN IF NOT EXISTS "spotify_url" text;
ALTER TABLE "saved_playlists" ADD COLUMN IF NOT EXISTS "vibe" text;
ALTER TABLE "saved_playlists" ADD COLUMN IF NOT EXISTS "mode" text;
`;

export async function runDbInit(rawPool: pg.Pool): Promise<void> {
  try {
    await rawPool.query(SCHEMA_DDL);
    logger.info("[db-init] schema verified — all tables ready");
  } catch (err) {
    throw new Error(`[db-init] Schema bootstrap failed: ${(err as Error).message}`);
  }
}
