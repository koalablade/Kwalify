import { pgTable, text, serial, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
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
});

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

export const insertLikedSongSchema = createInsertSchema(likedSongsTable).omit({ id: true, createdAt: true });
export const insertPlaylistHistorySchema = createInsertSchema(playlistHistoryTable).omit({ id: true, createdAt: true });
export const insertSyncStatusSchema = createInsertSchema(syncStatusTable).omit({ id: true });

export type LikedSong = typeof likedSongsTable.$inferSelect;
export type InsertLikedSong = z.infer<typeof insertLikedSongSchema>;
export type PlaylistHistory = typeof playlistHistoryTable.$inferSelect;
export type SyncStatus = typeof syncStatusTable.$inferSelect;
