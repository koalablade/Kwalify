# API Endpoints

All endpoints are mounted under the `/api` prefix. Requests without a valid session cookie return `401` where noted. Requests to Spotify-dependent endpoints when Spotify credentials are not configured return `503`.

## Authentication

### `GET /api/auth/login`
**Auth:** None  
Redirects the browser to Spotify's OAuth authorization page. Generates and stores a CSRF `state` token in the session before redirecting.

**503** if Spotify is not configured.

---

### `GET /api/auth/callback`
**Auth:** None (OAuth callback)  
Receives the OAuth callback from Spotify. Validates the `state` parameter, exchanges the `code` for tokens, fetches the user's Spotify profile, populates the session, and redirects to `/`.

On first login (user has never synced), fires a background library sync.

**Query params:** `code` (string), `state` (string), `error` (string, present if user denied)

**Redirect responses:**
- `/?error=...` on failure
- `/` on success

**400** if CSRF state mismatch.

---

### `POST /api/auth/logout`
**Auth:** None (destroys session)  
Destroys the current session.

**Response:** `{ message: "Logged out successfully" }`

---

### `GET /api/auth/me`
**Auth:** Session required  
Returns the current user's profile. Also performs a JIT token refresh if tokens are near expiry.

**Response (200):**
```json
{
  "id": "spotify_user_id",
  "displayName": "User Name",
  "email": "user@example.com",
  "avatarUrl": "https://...",
  "country": "GB"
}
```
**401** if not authenticated.

---

## Spotify Library Sync

### `GET /api/spotify/cache-status`
**Auth:** Session required  
Returns the current sync state for the authenticated user.

**Response (200):**
```json
{
  "synced": true,
  "totalTracks": 3842,
  "lastSyncedAt": "2025-01-15T14:30:00.000Z",
  "isSyncing": false,
  "syncProgress": null,
  "syncTotal": null,
  "suggestFullSync": false
}
```

`suggestFullSync` is `true` if ≥85% of the user's stored tracks were added in the last 120 days (heuristic for "library has been fully replaced").

**503** if Spotify is not configured.

---

### `POST /api/spotify/sync`
**Auth:** Session required  
Starts a background library sync. Returns immediately; sync runs asynchronously.

**Request body:**
```json
{ "full": true }
```
`full: true` forces a complete re-sync. Omit or `false` for incremental (new likes only).

**Response (200) — started:**
```json
{ "message": "Full sync started", "started": true, "full": true }
```

**Response (200) — already syncing:**
```json
{ "message": "Sync already in progress", "started": false }
```

**Response (200) — full sync cooldown:**
```json
{
  "message": "Library was synced recently...",
  "started": false,
  "skipped": true,
  "reason": "FULL_SYNC_COOLDOWN"
}
```
Full sync is rate-limited: if ≥500 tracks exist and last sync was within 6 hours, the request is rejected.

---

## Playlist Generation

### `POST /api/generate`
**Auth:** Session required  
The core endpoint. Scores the user's liked songs against the vibe, selects tracks, creates a Spotify playlist, saves to DB, returns result.

**Rate limit:** 5 requests per 60 seconds per user.

**Request body:**
```json
{
  "vibe": "late night drive on empty roads",
  "mode": "balanced",
  "length": 40,
  "referencePlaylist": "https://open.spotify.com/playlist/..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `vibe` | string (1–140 chars) | Yes | Free-text mood/scene description |
| `mode` | "strict" \| "balanced" \| "chaotic" | No (default: "balanced") | How strictly tracks must match the vibe |
| `length` | integer (10–100) | No (default: 40) | Target track count |
| `referencePlaylist` | string (URL) | No | Spotify playlist URL to bias matching |

**Response (200):**
```json
{
  "playlistName": "Kwalify: late night drive on empty roads",
  "spotifyPlaylistUrl": "https://open.spotify.com/playlist/...",
  "trackCount": 40,
  "tracks": [...],
  "playlistId": 17,
  "emotionProfile": { "energy": 0.45, "valence": 0.3, ... }
}
```

**Note:** `playlistId` in the response is an integer (the `saved_playlists.id`). The Zod schema in `api.ts` incorrectly declares it as `z.string()`.

**401** if not authenticated.  
**429** if rate limit exceeded.  
**503** if Spotify is not configured.  
**400** if the user's library is empty or not synced.

---

### `GET /api/generate/status`
**Auth:** Session required  
Returns the current generation phase for the authenticated user.

**Response (200):**
```json
{ "phase": "scoring" }
```

Possible phases: `"idle"`, `"scoring"`, `"building_profile"`, `"selecting_tracks"`, `"creating_playlist"`, `"done"`.

**Note:** This endpoint exists but is **not polled by the frontend**. The UI shows a static spinner during generation.

---

## Playlists

### `GET /api/playlists`
**Auth:** Session required  
Returns all saved playlists for the current user, most recent first.

**Response (200):**
```json
{
  "playlists": [
    {
      "id": 17,
      "name": "Kwalify: late night drive",
      "vibe": "late night drive on empty roads",
      "mode": "balanced",
      "spotifyUrl": "https://open.spotify.com/playlist/...",
      "tracks": [...],
      "emotionProfile": {...},
      "createdAt": "2025-01-15T14:30:00.000Z"
    }
  ]
}
```

---

### `DELETE /api/playlists/:id`
**Auth:** Session required  
Deletes a saved playlist. Ownership is checked — only the creator can delete.

**Path param:** `id` (integer)

**Response (200):** `{ "message": "Playlist deleted" }`  
**403** if the playlist belongs to a different user.  
**404** if not found.

---

### `GET /api/share/:id`
**Auth:** None (public)  
Returns a playlist for the public share page. No authentication required.

**Path param:** `id` (integer, the `saved_playlists.id`)

**Response (200):**
```json
{
  "id": 17,
  "name": "Kwalify: late night drive",
  "vibe": "late night drive on empty roads",
  "mode": "balanced",
  "spotifyUrl": "https://open.spotify.com/playlist/...",
  "tracks": [
    { "trackName": "Song", "artistName": "Artist", "albumName": "Album", "albumArt": "https://..." }
  ],
  "trackCount": 40,
  "createdAt": "2025-01-15T14:30:00.000Z"
}
```

**404** if not found.

---

### `POST /api/playlists/:id/feedback`
**Auth:** Session required  
Records a user reaction to a generated playlist. One feedback per user per playlist (upsert).

**Path param:** `id` (integer)

**Request body:**
```json
{ "reaction": "up" }
```
Valid reactions: `"up"`, `"neutral"`, `"down"`.

**Response (200):** `{ "message": "Feedback recorded" }`

**Note:** Feedback is written but **never read back** anywhere in the codebase.

---

## Library

### `GET /api/library/summary`
**Auth:** Session required  
Returns aggregate statistics about the user's synced library.

**Response (200):**
```json
{
  "trackCount": 3842,
  "artistCount": 587,
  "oldestLikedYear": 2009,
  "newestLikedYear": 2025,
  "topDecade": "2010s",
  "genreFamilyCount": 11
}
```

---

### `GET /api/library/chapters`
**Auth:** Session required  
Analyzes temporal patterns in the user's liked songs to identify "music life chapters".

**Note:** This endpoint is defined and functional but **not called by any frontend page**.

---

## History

### `GET /api/history`
**Auth:** Session required  
Returns up to 20 recent generation events for the current user.

**Response (200):** Array of history items:
```json
[
  {
    "id": 42,
    "playlistId": "5GrXXXXX",
    "playlistUrl": "https://open.spotify.com/playlist/...",
    "name": "Kwalify: late night drive",
    "vibe": "late night drive on empty roads",
    "mode": "balanced",
    "trackCount": 40,
    "createdAt": "2025-01-15T14:30:00.000Z"
  }
]
```

---

## Health

### `GET /api/healthz`
**Auth:** None  
Returns server health status. Always returns 200 if the server is up.

**Response (200):**
```json
{ "status": "ok" }
```
