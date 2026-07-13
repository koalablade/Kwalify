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
ALTER TABLE "liked_songs" ADD COLUMN IF NOT EXISTS "primary_artist_id" text;
ALTER TABLE "liked_songs" ADD COLUMN IF NOT EXISTS "artist_ids" jsonb;
ALTER TABLE "liked_songs" ADD COLUMN IF NOT EXISTS "semantic_profile" jsonb;
ALTER TABLE "liked_songs" ADD COLUMN IF NOT EXISTS "enrichment_version" text;
ALTER TABLE "liked_songs" ADD COLUMN IF NOT EXISTS "enriched_at" timestamp;
CREATE INDEX IF NOT EXISTS "IDX_liked_songs_semantic_enrichment"
  ON "liked_songs" ("spotify_user_id", "enrichment_version");

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
ALTER TABLE "sync_status" ADD COLUMN IF NOT EXISTS "sync_error" text;

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
ALTER TABLE "playlist_feedback" ADD COLUMN IF NOT EXISTS "scene_id" text;

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

CREATE TABLE IF NOT EXISTS "unknown_term_events" (
  "id" serial PRIMARY KEY,
  "user_id" text,
  "term" text NOT NULL,
  "prompt" text NOT NULL,
  "prompt_hash" text NOT NULL,
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_unknown_term_events_term_created"
  ON "unknown_term_events" ("term", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "IDX_unknown_term_events_prompt_hash"
  ON "unknown_term_events" ("prompt_hash");

CREATE TABLE IF NOT EXISTS "scene_alias_promotions" (
  "id" serial PRIMARY KEY,
  "term" text NOT NULL UNIQUE,
  "aliases" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "occurrences" integer NOT NULL DEFAULT 0,
  "source" text NOT NULL DEFAULT 'harvest',
  "promoted_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "prompt_scene_memory" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL,
  "prompt_hash" text NOT NULL,
  "prompt_sample" text NOT NULL,
  "scene_key" text,
  "genre_families" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "coherence_score" real,
  "familiarity_mode" text,
  "generation_count" integer NOT NULL DEFAULT 1,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_prompt_scene_memory_user_prompt"
  ON "prompt_scene_memory" ("user_id", "prompt_hash");

ALTER TABLE "scene_alias_promotions" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'approved';

CREATE TABLE IF NOT EXISTS "user_taste_graph" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL UNIQUE,
  "nodes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "edges" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "genre_weights" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_global_taste" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL UNIQUE,
  "genre_weights" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "scene_weights" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "artist_weights" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "generation_count" integer NOT NULL DEFAULT 0,
  "avg_coherence" real,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "scene_culture_embeddings" (
  "id" serial PRIMARY KEY,
  "entity_key" text NOT NULL UNIQUE,
  "entity_type" text NOT NULL,
  "label" text NOT NULL,
  "embedding" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "genre_families" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "trend_snapshots" (
  "id" serial PRIMARY KEY,
  "source" text NOT NULL,
  "trends" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "fetched_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "playlist_failure_events" (
  "id" serial PRIMARY KEY,
  "session_id" text NOT NULL UNIQUE,
  "user_id_hash" text,
  "event_type" text NOT NULL,
  "prompt_category" text NOT NULL,
  "activity" text,
  "scene_id" text,
  "prompt_hash" text NOT NULL,
  "capability_score" real,
  "limiting_factors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "retrieval_strategy" text,
  "candidate_quality_score" real,
  "combined_confidence" real,
  "user_outcome" text,
  "linked_session_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "outcome_recorded_at" timestamp
);
CREATE INDEX IF NOT EXISTS "IDX_playlist_failure_events_category_created"
  ON "playlist_failure_events" ("prompt_category", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "IDX_playlist_failure_events_event_type"
  ON "playlist_failure_events" ("event_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "IDX_playlist_failure_events_outcome"
  ON "playlist_failure_events" ("user_outcome", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "generation_signals" (
  "id" serial PRIMARY KEY,
  "generation_id" text NOT NULL UNIQUE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "prompt" text NOT NULL,
  "prompt_hash" text NOT NULL,
  "user_id_hash" text,
  "mode" text,
  "interpreted_moment" jsonb,
  "expectation_contract" jsonb,
  "grounded_confidence" real,
  "novel_prompt" boolean,
  "candidate_count" integer,
  "candidate_pool_admissible_rate" real,
  "rerank_promotions" integer,
  "rerank_demotions" integer,
  "avg_fit_before" real,
  "avg_fit_after" real,
  "critic_score" integer,
  "critic_verdict" text,
  "repair_count" integer,
  "failure_modes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "publish_decision" text,
  "generation_time_ms" integer,
  "pipeline_version" text,
  "expectation_version" text,
  "shadow_or_enforce" text NOT NULL,
  "user_feedback" jsonb
);
CREATE INDEX IF NOT EXISTS "IDX_generation_signals_created"
  ON "generation_signals" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "IDX_generation_signals_mode"
  ON "generation_signals" ("shadow_or_enforce", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "IDX_generation_signals_prompt_hash"
  ON "generation_signals" ("prompt_hash");
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
