# Kwalify — Full Application Audit Report

**Date:** June 2025  
**Scope:** Full read-only audit of the entire codebase. No code changes.

---

## Summary

Kwalify is a working, coherent application. The core flow (OAuth → sync → generate → Spotify playlist) is functional and well-structured. The bootstrap sequence is robust. Authentication is correct. The main risks are: schema drift in the Zod layer, unused but maintained code paths, an unduplicated sync count bug, and write-only `playlist_feedback` data.

---

## 1. What Works Correctly

| System | Assessment |
|---|---|
| Server bootstrap (5-phase, fail-fast) | ✅ Solid |
| Boot-locked DB/pool proxies | ✅ Correct pattern |
| Spotify OAuth 2.0 with CSRF protection | ✅ Correct |
| JIT token refresh with in-flight dedup | ✅ Correct |
| Auto-sync on first login | ✅ Working |
| Full + incremental library sync | ✅ Working |
| Audio feature preservation across full syncs | ✅ Correct |
| Full-sync cooldown (6h for >500 tracks) | ✅ Working |
| Playlist generation pipeline | ✅ Working |
| Rate limiting (5 req/60s) | ✅ Working (in-memory) |
| Graceful shutdown (SIGTERM, 25s) | ✅ Correct |
| Session persistence (PostgreSQL) | ✅ Working |
| Static file serving + SPA routing | ✅ Working |
| CORS (dev: open, prod: origin-list) | ✅ Correct |
| Secure cookies in production | ✅ Correct |

---

## 2. Bugs

### BUG-01 — Incremental sync track count can become stale

**File:** `backend/routes/spotify.ts`, `runSync()`  
**Severity:** Medium

After an incremental sync, the total track count is computed as:
```ts
finalTotalTracks = existingStatus.totalTracks + newTracks.length
```
This only accounts for newly added tracks. If a user **unlikes** songs between syncs, the stored `total_tracks` will be higher than the actual library size. The count displayed in the UI will be wrong. A full sync corrects this.

---

### BUG-02 — No UNIQUE constraint on `(spotify_user_id, track_id)` in `liked_songs`

**File:** `backend/db/schema/kwalah.ts`, `backend/lib/db-init.ts`  
**Severity:** Low (unlikely in practice, but structurally unsafe)

If the incremental sync cutoff logic has an edge case (e.g., a track is liked at exactly the `lastSyncedAt` timestamp), the same track could be inserted twice. A UNIQUE constraint on `(spotify_user_id, track_id)` would prevent this and would allow safe `INSERT ... ON CONFLICT DO NOTHING`.

---

### BUG-03 — `history.ts` has no error handling

**File:** `backend/routes/history.ts`  
**Severity:** Low

`GET /api/history` executes a database query with no try/catch. If the DB query fails, the unhandled rejection propagates to Express's default error handler, which returns an HTML 500 response. This is inconsistent with all other endpoints that return JSON errors. The frontend's `.json().catch(() => ({}))` will silently return `{}`, showing no history items rather than an error message.

---

### BUG-04 — Zod schema drift: `GeneratePlaylistResponse.playlistId`

**File:** `backend/zod/api.ts`  
**Severity:** Low (cosmetic — not validated on response)

`GeneratePlaylistResponse` declares `playlistId: z.string()` but `generation.controller.ts` sends `playlistId` as an integer (`saved_playlists.id`). The frontend correctly uses it as a number in `/p/${result.savedPlaylistId}`. The schema is unused at runtime on the response path, but creates a misleading type contract.

---

### BUG-05 — Frontend landing page claims "0 data stored on server"

**File:** `frontend/public/pages/app.js`, line 164  
**Severity:** Low (marketing copy inaccuracy)

The stats bar displays: `"0 — Data stored on server"`. In reality, all liked songs (including audio features, artist names, album art URLs), sync status, and generated playlist data are stored in the PostgreSQL database. This is misleading.

---

## 3. Unused / Dead Code

### UNUSED-01 — `GET /api/library/chapters` has no frontend caller

**File:** `backend/routes/library.ts`  
The `library/chapters` endpoint analyzes liked songs for temporal "life chapters". It is fully implemented and functional. No frontend page calls it. If the feature is intended for a future UI, it should be marked accordingly. If it is abandoned, the handler and DB queries can be removed.

---

### UNUSED-02 — `GET /api/generate/status` is not polled by the frontend

**File:** `backend/controllers/generation.controller.ts`  
A status-tracking map (`Map<userId, phase>`) is maintained and exposed via `GET /api/generate/status`. The frontend shows a static spinner during generation and does not poll this endpoint. The status map is updated but the data goes nowhere.

---

### UNUSED-03 — `playlist_feedback` data is write-only

**File:** `backend/controllers/playlist-crud.controller.ts`, `backend/db/schema/kwalah.ts`  
`POST /api/playlists/:id/feedback` correctly records user reactions. However, no endpoint reads this data back. No analytics, no UI surfaces feedback results, no generation logic uses it. The data accumulates without being used.

---

### UNUSED-04 — Several Zod schemas are defined but never validated

**File:** `backend/zod/api.ts`  
- `AuthCallbackQueryParams` — the callback route manually destructures `req.query` rather than validating with this schema.
- `GetHistoryResponse` — `history.ts` returns plain DB rows without validating against this schema.
- `GetHistoryResponseItem` — same.

---

### UNUSED-05 — `esc()`, `formatDate()`, `spotifyIconSvg()` duplicated across 3 files

**Files:** `frontend/public/pages/app.js`, `gallery.js`, `playlist.js`  
Three utility functions are copy-pasted into each page. A shared `utils.js` ES module would eliminate the duplication, though this is cosmetic only.

---

## 4. Design Observations (Not Bugs)

### OBS-01 — No global auth middleware

Authentication is checked with a manual `if (!req.session.spotifyUserId)` guard in each protected handler. This works but means new routes can accidentally be added without auth protection. A `requireAuth` middleware applied at the router level would be safer.

### OBS-02 — `playlist_history` and `saved_playlists` are redundant

Both tables store generated playlists. `playlist_history` stores the Spotify playlist ID and track IDs only. `saved_playlists` stores full track metadata for rendering the share page. They are written together on each generation. Merging them (or documenting the distinction clearly) would reduce confusion.

### OBS-03 — In-memory rate limiting and sync deduplication

Both the generation rate limiter (`Map<userId, timestamps[]>`) and the active-sync deduplicator (`Set<userId>`) live in process memory. On server restart, these reset. On multi-instance deployments, they are not shared. For the current single-instance Replit deployment this is fine, but would need a Redis or DB-backed solution for horizontal scaling.

### OBS-04 — Library chunks are loaded entirely into memory during generation

`generation.controller.ts` loads all `liked_songs` rows for the user into a JavaScript array before scoring. For users with very large libraries (10,000+ tracks) this could cause memory pressure. A streaming or chunked approach would be more scalable.

### OBS-05 — `playlist_history.playlist_id` is a Spotify playlist ID (string)

The field name `playlist_id` in `playlist_history` refers to the Spotify-side playlist ID, not the `saved_playlists.id`. Meanwhile, `saved_playlists.id` (integer) is what the frontend uses in share URLs. This naming is confusing but consistent within each table.

---

## 5. Security Observations

| Item | Assessment |
|---|---|
| CSRF on OAuth state | ✅ 32-byte random state, validated on callback |
| Session tokens in plaintext in PostgreSQL | ℹ️ Standard practice; protected by `SESSION_SECRET` |
| No HTTPS termination in app (handled by Replit proxy) | ✅ Correct |
| `GET /api/share/:id` is unauthenticated | ✅ Intentional (share links) |
| No SQL injection surface | ✅ All queries use Drizzle ORM parameterised queries |
| `esc()` HTML escaping in frontend templates | ✅ Present in all three pages |
| Ownership check on DELETE `/api/playlists/:id` | ✅ Present |
| No ownership check on feedback endpoint | ℹ️ Any authenticated user can submit feedback for any playlist ID |
| Rate limiting on `/api/generate` | ✅ Present (in-memory) |
| No rate limiting on sync or auth endpoints | ℹ️ Brute-force possible on `/api/auth/callback` |

---

## 6. Recommended Actions (Priority Order)

| Priority | Item | Effort |
|---|---|---|
| High | Fix BUG-01 (incremental sync count) — track total correctly by querying DB count after sync | Small |
| High | Add UNIQUE constraint on `liked_songs(spotify_user_id, track_id)` | Small (migration) |
| Medium | Add try/catch to `history.ts` and `library/chapters` handlers | Trivial |
| Medium | Fix BUG-04 — correct `playlistId` type in Zod schema to `z.number()` | Trivial |
| Medium | Decide on `playlist_feedback`: either build a UI/analytics for it or remove it | Design decision |
| Medium | Decide on `library/chapters`: either build a frontend UI or remove the endpoint | Design decision |
| Low | Add `requireAuth` middleware and replace per-handler auth checks | Medium refactor |
| Low | Add ownership check to feedback endpoint | Trivial |
| Low | Correct landing page copy: "0 data stored on server" | Trivial |
| Low | Extract shared frontend utils (`esc`, `formatDate`, `spotifyIconSvg`) into a module | Small |
| Low | Delete unused Zod schemas or wire them up | Small |
