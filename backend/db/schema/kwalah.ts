import { pgTable, text, serial, integer, real, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
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
  addedAt: timestamp("added_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userAddedIndex: index("IDX_liked_songs_user_added").on(table.spotifyUserId, table.addedAt),
  userTrackUnique: uniqueIndex("IDX_liked_songs_user_track").on(table.spotifyUserId, table.trackId),
}));

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userCreatedIndex: index("IDX_saved_playlists_user_created").on(table.userId, table.createdAt),
}));

export const playlistFeedbackTable = pgTable("playlist_feedback", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id").notNull(),
  userId: text("user_id").notNull(),
  vibe: text("vibe").notNull(),
  reaction: text("reaction").notNull(),
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

export const insertLikedSongSchema = createInsertSchema(likedSongsTable).omit({ id: true, createdAt: true });
export const insertPlaylistHistorySchema = createInsertSchema(playlistHistoryTable).omit({ id: true, createdAt: true });
export const insertSyncStatusSchema = createInsertSchema(syncStatusTable).omit({ id: true });

export type LikedSong = typeof likedSongsTable.$inferSelect;
export type InsertLikedSong = z.infer<typeof insertLikedSongSchema>;
export type PlaylistHistory = typeof playlistHistoryTable.$inferSelect;
export type SyncStatus = typeof syncStatusTable.$inferSelect;
export type SavedPlaylist = typeof savedPlaylistsTable.$inferSelect;
export type UserFeedbackMemory = typeof userFeedbackMemoryTable.$inferSelect;
