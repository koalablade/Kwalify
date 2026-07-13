import { pgTable, text, serial, integer, real, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const likedSongsTable = pgTable("liked_songs", {
  id: serial("id").primaryKey(),
  spotifyUserId: text("spotify_user_id").notNull(),
  trackId: text("track_id").notNull(),
  trackName: text("track_name").notNull(),
  artistName: text("artist_name").notNull(),
  albumName: text("album_name").notNull(),
  albumArt: text("album_art"),
  durationMs: integer("duration_ms").notNull(),
  energy: real("energy"),
  valence: real("valence"),
  tempo: real("tempo"),
  danceability: real("danceability"),
  acousticness: real("acousticness"),
  instrumentalness: real("instrumentalness"),
  loudness: real("loudness"),
  speechiness: real("speechiness"),
  spotifyArtistGenres: jsonb("spotify_artist_genres"),
  albumGenres: jsonb("album_genres"),
  popularity: integer("popularity"),
  releaseYear: integer("release_year"),
  primaryArtistId: text("primary_artist_id"),
  artistIds: jsonb("artist_ids"),
  semanticProfile: jsonb("semantic_profile"),
  enrichmentVersion: text("enrichment_version"),
  enrichedAt: timestamp("enriched_at"),
  addedAt: timestamp("added_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userAddedIndex: index("IDX_liked_songs_user_added").on(table.spotifyUserId, table.addedAt),
  userTrackUnique: uniqueIndex("IDX_liked_songs_user_track").on(table.spotifyUserId, table.trackId),
}));

/** Staging buffer for full sync — main table is replaced only after successful fetch. */
export const likedSongsStagingTable = pgTable("liked_songs_staging", {
  id: serial("id").primaryKey(),
  spotifyUserId: text("spotify_user_id").notNull(),
  trackId: text("track_id").notNull(),
  trackName: text("track_name").notNull(),
  artistName: text("artist_name").notNull(),
  albumName: text("album_name").notNull(),
  albumArt: text("album_art"),
  durationMs: integer("duration_ms").notNull(),
  energy: real("energy"),
  valence: real("valence"),
  tempo: real("tempo"),
  danceability: real("danceability"),
  acousticness: real("acousticness"),
  instrumentalness: real("instrumentalness"),
  loudness: real("loudness"),
  speechiness: real("speechiness"),
  addedAt: timestamp("added_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const playlistHistoryTable = pgTable("playlist_history", {
  id: serial("id").primaryKey(),
  spotifyUserId: text("spotify_user_id").notNull(),
  playlistId: text("playlist_id").notNull(),
  playlistUrl: text("playlist_url").notNull(),
  name: text("name").notNull(),
  vibe: text("vibe").notNull(),
  mode: text("mode").notNull(),
  trackCount: integer("track_count").notNull(),
  emotionProfile: jsonb("emotion_profile"),
  trackIds: jsonb("track_ids"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userCreatedIndex: index("IDX_playlist_history_user_created").on(table.spotifyUserId, table.createdAt),
}));

export const syncStatusTable = pgTable("sync_status", {
  id: serial("id").primaryKey(),
  spotifyUserId: text("spotify_user_id").notNull().unique(),
  totalTracks: integer("total_tracks").notNull().default(0),
  isSyncing: integer("is_syncing").notNull().default(0),
  syncProgress: integer("sync_progress"),
  syncTotal: integer("sync_total"),
  lastSyncedAt: timestamp("last_synced_at"),
  syncError: text("sync_error"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const savedPlaylistsTable = pgTable("saved_playlists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  emotionProfile: jsonb("emotion_profile"),
  tracks: jsonb("tracks"),
  spotifyUrl: text("spotify_url"),
  vibe: text("vibe"),
  mode: text("mode"),
  shareSlug: text("share_slug"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userCreatedIndex: index("IDX_saved_playlists_user_created").on(table.userId, table.createdAt),
  shareSlugUnique: index("IDX_saved_playlists_share_slug").on(table.shareSlug),
}));

export const playlistFeedbackTable = pgTable("playlist_feedback", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id").notNull(),
  userId: text("user_id").notNull(),
  vibe: text("vibe").notNull(),
  reaction: text("reaction").notNull(),
  sceneId: text("scene_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userFeedbackMemoryTable = pgTable("user_feedback_memory", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  badArtists: jsonb("bad_artists").notNull().default([]),
  badGenres: jsonb("bad_genres").notNull().default([]),
  badEnergyTypes: jsonb("bad_energy_types").notNull().default([]),
  badMoodMatches: jsonb("bad_mood_matches").notNull().default([]),
  badBridges: jsonb("bad_bridges").notNull().default([]),
  overplayedTracks: jsonb("overplayed_tracks").notNull().default([]),
  skipCountByTrack: jsonb("skip_count_by_track").notNull().default({}),
  saveCountByTrack: jsonb("save_count_by_track").notNull().default({}),
  artistAffinityGraph: jsonb("artist_affinity_graph").notNull().default({}),
  albumAffinityGraph: jsonb("album_affinity_graph").notNull().default({}),
  sceneEmbeddings: jsonb("scene_embeddings").notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const unknownTermEventsTable = pgTable("unknown_term_events", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  term: text("term").notNull(),
  prompt: text("prompt").notNull(),
  promptHash: text("prompt_hash").notNull(),
  context: jsonb("context").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  termCreatedIndex: index("IDX_unknown_term_events_term_created").on(table.term, table.createdAt),
  promptHashIndex: index("IDX_unknown_term_events_prompt_hash").on(table.promptHash),
}));

export const sceneAliasPromotionsTable = pgTable("scene_alias_promotions", {
  id: serial("id").primaryKey(),
  term: text("term").notNull().unique(),
  aliases: jsonb("aliases").notNull().default([]),
  occurrences: integer("occurrences").notNull().default(0),
  source: text("source").notNull().default("harvest"),
  status: text("status").notNull().default("pending"),
  promotedAt: timestamp("promoted_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userTasteGraphTable = pgTable("user_taste_graph", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  nodes: jsonb("nodes").notNull().default([]),
  edges: jsonb("edges").notNull().default([]),
  genreWeights: jsonb("genre_weights").notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userGlobalTasteTable = pgTable("user_global_taste", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  genreWeights: jsonb("genre_weights").notNull().default({}),
  sceneWeights: jsonb("scene_weights").notNull().default({}),
  artistWeights: jsonb("artist_weights").notNull().default({}),
  generationCount: integer("generation_count").notNull().default(0),
  avgCoherence: real("avg_coherence"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sceneCultureEmbeddingsTable = pgTable("scene_culture_embeddings", {
  id: serial("id").primaryKey(),
  entityKey: text("entity_key").notNull().unique(),
  entityType: text("entity_type").notNull(),
  label: text("label").notNull(),
  embedding: jsonb("embedding").notNull().default([]),
  genreFamilies: jsonb("genre_families").notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const trendSnapshotsTable = pgTable("trend_snapshots", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  trends: jsonb("trends").notNull().default([]),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

export const promptSceneMemoryTable = pgTable("prompt_scene_memory", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  promptHash: text("prompt_hash").notNull(),
  promptSample: text("prompt_sample").notNull(),
  sceneKey: text("scene_key"),
  genreFamilies: jsonb("genre_families").notNull().default([]),
  coherenceScore: real("coherence_score"),
  familiarityMode: text("familiarity_mode"),
  generationCount: integer("generation_count").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userPromptIndex: index("IDX_prompt_scene_memory_user_prompt").on(table.userId, table.promptHash),
}));

/** Playlist capability failures and outcomes — learn where liked-library mode falls short. */
export const playlistFailureEventsTable = pgTable("playlist_failure_events", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  userIdHash: text("user_id_hash"),
  eventType: text("event_type").notNull(),
  promptCategory: text("prompt_category").notNull(),
  activity: text("activity"),
  sceneId: text("scene_id"),
  promptHash: text("prompt_hash").notNull(),
  capabilityScore: real("capability_score"),
  limitingFactors: jsonb("limiting_factors").notNull().default([]),
  retrievalStrategy: text("retrieval_strategy"),
  candidateQualityScore: real("candidate_quality_score"),
  combinedConfidence: real("combined_confidence"),
  userOutcome: text("user_outcome"),
  linkedSessionId: text("linked_session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  outcomeRecordedAt: timestamp("outcome_recorded_at"),
}, (table) => ({
  categoryCreatedIndex: index("IDX_playlist_failure_events_category_created").on(table.promptCategory, table.createdAt),
  eventTypeIndex: index("IDX_playlist_failure_events_event_type").on(table.eventType, table.createdAt),
  userOutcomeIndex: index("IDX_playlist_failure_events_outcome").on(table.userOutcome, table.createdAt),
}));

/**
 * Human Expectation Layer instrumentation — one row per generation carrying the
 * interpreted moment, contract, re-rank deltas and critic verdict. Designed so
 * future learning (user_feedback) can be joined in without a schema redesign.
 */
export const generationSignalsTable = pgTable("generation_signals", {
  id: serial("id").primaryKey(),
  generationId: text("generation_id").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  prompt: text("prompt").notNull(),
  promptHash: text("prompt_hash").notNull(),
  userIdHash: text("user_id_hash"),
  mode: text("mode"),
  interpretedMoment: jsonb("interpreted_moment"),
  expectationContract: jsonb("expectation_contract"),
  groundedConfidence: real("grounded_confidence"),
  novelPrompt: boolean("novel_prompt"),
  candidateCount: integer("candidate_count"),
  candidatePoolAdmissibleRate: real("candidate_pool_admissible_rate"),
  rerankPromotions: integer("rerank_promotions"),
  rerankDemotions: integer("rerank_demotions"),
  avgFitBefore: real("avg_fit_before"),
  avgFitAfter: real("avg_fit_after"),
  criticScore: integer("critic_score"),
  criticVerdict: text("critic_verdict"),
  repairCount: integer("repair_count"),
  failureModes: jsonb("failure_modes").notNull().default([]),
  publishDecision: text("publish_decision"),
  generationTimeMs: integer("generation_time_ms"),
  pipelineVersion: text("pipeline_version"),
  expectationVersion: text("expectation_version"),
  shadowOrEnforce: text("shadow_or_enforce").notNull(),
  userFeedback: jsonb("user_feedback"),
}, (table) => ({
  createdIndex: index("IDX_generation_signals_created").on(table.createdAt),
  modeIndex: index("IDX_generation_signals_mode").on(table.shadowOrEnforce, table.createdAt),
  promptHashIndex: index("IDX_generation_signals_prompt_hash").on(table.promptHash),
}));

export const insertLikedSongSchema = createInsertSchema(likedSongsTable).omit({ id: true, createdAt: true });
export const insertPlaylistHistorySchema = createInsertSchema(playlistHistoryTable).omit({ id: true, createdAt: true });
export const insertSyncStatusSchema = createInsertSchema(syncStatusTable).omit({ id: true });

export type LikedSong = typeof likedSongsTable.$inferSelect;
export type InsertLikedSong = z.infer<typeof insertLikedSongSchema>;
export type PlaylistHistory = typeof playlistHistoryTable.$inferSelect;
export type SyncStatus = typeof syncStatusTable.$inferSelect;
export type SavedPlaylist = typeof savedPlaylistsTable.$inferSelect;
export type UserFeedbackMemory = typeof userFeedbackMemoryTable.$inferSelect;
