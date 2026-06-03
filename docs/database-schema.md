# Database Schema

## Overview

PostgreSQL database. Schema is defined in `backend/db/schema/kwalah.ts` (Drizzle ORM) and mirrored as raw idempotent DDL in `backend/lib/db-init.ts`. All tables are created via `CREATE TABLE IF NOT EXISTS` at server startup.

## Tables

---

### `liked_songs`

Stores every track from a user's Spotify Liked Songs library, including Spotify audio features.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | serial | NOT NULL | Primary key |
| `spotify_user_id` | text | NOT NULL | Spotify user ID (FK-like, no constraint) |
| `track_id` | text | NOT NULL | Spotify track ID |
| `track_name` | text | NOT NULL | Track title |
| `artist_name` | text | NOT NULL | First artist name |
| `album_name` | text | NOT NULL | Album name |
| `album_art` | text | NULL | Album art URL (from Spotify) |
| `duration_ms` | integer | NOT NULL | Track duration in milliseconds |
| `energy` | real | NULL | Spotify audio feature: 0.0–1.0 |
| `valence` | real | NULL | Spotify audio feature: 0.0–1.0 (positivity) |
| `tempo` | real | NULL | Spotify audio feature: BPM |
| `danceability` | real | NULL | Spotify audio feature: 0.0–1.0 |
| `acousticness` | real | NULL | Spotify audio feature: 0.0–1.0 |
| `instrumentalness` | real | NULL | Spotify audio feature: 0.0–1.0 |
| `loudness` | real | NULL | Spotify audio feature: dB (typically −60 to 0) |
| `speechiness` | real | NULL | Spotify audio feature: 0.0–1.0 |
| `added_at` | timestamp | NULL | When the user liked the track on Spotify |
| `created_at` | timestamp | NOT NULL | Row insert time, DEFAULT now() |

**Indexes:** `IDX_liked_songs_user` on `(spotify_user_id)`

**Notes:**
- Audio features can be NULL if Spotify's API returned 403 or did not include them during sync.
- No UNIQUE constraint on `(spotify_user_id, track_id)`. An incremental sync followed by a full sync correctly avoids duplicates (full sync deletes first), but a bug in incremental sync tracking could create duplicate rows.
- During a full sync, the user's rows are deleted then re-inserted in batches of 200.

**Read by:** `routes/library.ts`, `controllers/generation.controller.ts`, `routes/spotify.ts` (count queries)

**Written by:** `routes/spotify.ts` (bulk insert during sync, delete during full sync)

---

### `sync_status`

One row per user, tracking the state of their library sync process.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | serial | NOT NULL | Primary key |
| `spotify_user_id` | text | NOT NULL, UNIQUE | Spotify user ID |
| `total_tracks` | integer | NOT NULL | Total tracks in library as of last completed sync |
| `is_syncing` | integer | NOT NULL | 0 = idle, 1 = in progress |
| `sync_progress` | integer | NULL | Tracks processed in current sync |
| `sync_total` | integer | NULL | Expected total for current sync |
| `last_synced_at` | timestamp | NULL | When last sync completed |
| `updated_at` | timestamp | NOT NULL | Last row update time |

**Indexes:** `IDX_sync_status_user` on `(spotify_user_id)`

**Notes:**
- `is_syncing` is an integer (0/1) rather than a boolean for SQLite compatibility in historical code — the application now targets PostgreSQL only.
- Both `is_syncing` DB value and the in-memory `activeSyncs: Set<string>` are checked when reporting sync status (either counts as "syncing").

**Read by:** `routes/auth.ts` (auto-sync check), `routes/spotify.ts` (cache-status, sync cooldown)

**Written by:** `routes/auth.ts` (init on first login), `routes/spotify.ts` (progress updates throughout sync)

---

### `saved_playlists`

The primary store for generated playlists. Created when generation succeeds.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | serial | NOT NULL | Primary key (used in share URLs `/p/:id`) |
| `user_id` | text | NOT NULL | Spotify user ID |
| `name` | text | NOT NULL | Playlist name |
| `emotion_profile` | jsonb | NULL | Scoring metadata (energy, valence, timeOfDay, environment, nostalgia, etc.) |
| `tracks` | jsonb | NULL | Array of `{trackId, trackName, artistName, albumName, albumArt}` |
| `spotify_url` | text | NULL | Public Spotify playlist URL |
| `vibe` | text | NULL | Original user vibe input |
| `mode` | text | NULL | "strict" \| "balanced" \| "chaotic" |
| `created_at` | timestamp | NOT NULL | DEFAULT now() |

**Indexes:** `IDX_saved_playlists_user` on `(user_id)`

**Notes:**
- `tracks` stores full track metadata as JSONB so the share page can render the tracklist without querying `liked_songs`.
- The `emotion_profile` JSONB shape is determined by the generation engine; not validated by a fixed schema.

**Read by:** `controllers/playlist-crud.controller.ts` (list, share, delete)

**Written by:** `controllers/generation.controller.ts` (after successful generation)

---

### `playlist_history`

Log of all generation events. Overlaps with `saved_playlists` but stores different fields.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | serial | NOT NULL | Primary key |
| `spotify_user_id` | text | NOT NULL | Spotify user ID |
| `playlist_id` | text | NOT NULL | Spotify playlist ID (not the internal `saved_playlists.id`) |
| `playlist_url` | text | NOT NULL | Spotify playlist URL |
| `name` | text | NOT NULL | Playlist name |
| `vibe` | text | NOT NULL | Original vibe input |
| `mode` | text | NOT NULL | Match mode |
| `track_count` | integer | NOT NULL | Number of tracks in playlist |
| `emotion_profile` | jsonb | NULL | Emotion/scoring metadata |
| `track_ids` | jsonb | NULL | Array of Spotify track IDs only |
| `created_at` | timestamp | NOT NULL | DEFAULT now() |

**Indexes:** `IDX_playlist_history_user` on `(spotify_user_id)`

**Notes:**
- `track_ids` stores only Spotify track IDs (not full metadata). The `GET /api/history` response returns these rows directly.
- `playlist_history.playlist_id` is the Spotify playlist ID string; `saved_playlists.id` is an auto-incremented integer.
- These two tables serve overlapping purposes and may be consolidation candidates.

**Read by:** `routes/history.ts`

**Written by:** `controllers/generation.controller.ts`

---

### `playlist_feedback`

User reactions to generated playlists.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | serial | NOT NULL | Primary key |
| `playlist_id` | integer | NOT NULL | References `saved_playlists.id` (no FK constraint) |
| `user_id` | text | NOT NULL | Spotify user ID |
| `vibe` | text | NOT NULL | Original vibe input |
| `reaction` | text | NOT NULL | "up" \| "neutral" \| "down" |
| `created_at` | timestamp | NOT NULL | DEFAULT now() |

**Indexes:** `IDX_playlist_feedback_pl_user` — UNIQUE on `(playlist_id, user_id)` (one feedback per playlist per user)

**Notes:**
- Feedback is written via `POST /api/playlists/:id/feedback` but **never read back** anywhere in the application. The data is collected but unused.
- No FK constraint enforcing `playlist_id` references a valid `saved_playlists.id`.

**Written by:** `controllers/playlist-crud.controller.ts`

---

### `session`

Managed entirely by `connect-pg-simple`. Not directly accessed by application code.

| Column | Type | Description |
|---|---|---|
| `sid` | varchar | Session ID (primary key) |
| `sess` | json | Full session data (tokens, user info) |
| `expire` | timestamp | Session expiry |

**Indexes:** `IDX_session_expire` on `(expire)` — used by `connect-pg-simple` for cleanup.

**Notes:**
- Session data includes `spotifyTokens` (access token, refresh token, expiry), `spotifyUserId`, display name, email, avatar URL, country, and `oauthState` (only during login flow).
- Sensitive tokens are stored in plaintext in this table. Access is protected only by `SESSION_SECRET` cookie signing.

## Entity Relationship Summary

```
spotify_user_id (string, from Spotify)
  │
  ├── liked_songs (many rows per user)
  ├── sync_status (exactly one row per user)
  ├── saved_playlists (many rows per user)
  │     └── playlist_feedback (one row per user+playlist)
  └── playlist_history (many rows per user)
```

No foreign key constraints are defined between any application tables. Referential integrity is enforced only by application logic.
