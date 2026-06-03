# Backend Architecture

## Entry Points

### `backend/server.ts`
The process entry point. Calls `bootstrap()` which runs the 5-phase startup sequence (see System Overview), then starts the HTTP server. Also installs a `SIGTERM` handler that:
1. Stops accepting new connections.
2. Waits up to 25 seconds for in-flight requests to drain.
3. Closes the database pool.
4. Exits with code 0.

### `backend/app.ts`
The Express app factory. Registers middleware in order:
1. `pino-http` request logger (attaches `req.log`)
2. `express.json()` body parser
3. CORS (origins derived from `APP_URL` + `FRONTEND_URL` env vars; in development, `*`)
4. `express-session` with `connect-pg-simple` store
5. Static file serving from `frontend/public/` (index.html served for `/`, `/gallery`, `/p/:id`)
6. API routes mounted at `/api` via `routes/index.ts`

## Middleware Stack Details

### Session Configuration
```
store:   connect-pg-simple (PostgreSQL `session` table)
secret:  SESSION_SECRET env var
resave:  false
saveUninitialized: false
cookie:
  httpOnly: true
  secure:   true in production (NODE_ENV=production)
  sameSite: "lax" in production
  maxAge:   30 days
```

### CORS
- In development: all origins allowed.
- In production: only origins matching `APP_URL` or `FRONTEND_URL` (comma-separated list) are allowed.

## Route Map

All routes are mounted under `/api` in `routes/index.ts`.

| File | Prefix | Purpose |
|---|---|---|
| `routes/auth.ts` | `/api/auth` | Spotify OAuth + session lifecycle |
| `routes/spotify.ts` | `/api/spotify` | Library sync |
| `routes/library.ts` | `/api/library` | Library statistics |
| `routes/history.ts` | `/api` | Generation history |
| `routes/health.ts` | `/api` | Health check |
| `controllers/generation.controller.ts` | `/api` | Playlist generation |
| `controllers/playlist-crud.controller.ts` | `/api` | Playlist CRUD + share + feedback |

## Authentication Flow (`routes/auth.ts`)

### Login
1. `GET /api/auth/login` — generates a 32-byte random hex `state`, stores in `req.session.oauthState`, saves session, redirects to Spotify's `/authorize` URL.
2. Spotify redirects to `GET /api/auth/callback` with `code` and `state`.
3. Server validates `state` against `req.session.oauthState` (CSRF protection).
4. Exchanges `code` for tokens using `lib/spotify.ts → exchangeCode()`.
5. Fetches Spotify user profile.
6. Stores in session: `spotifyTokens` (accessToken, refreshToken, expiresAt), `spotifyUserId`, `spotifyDisplayName`, `spotifyEmail`, `spotifyAvatarUrl`, `spotifyCountry`.
7. Checks `sync_status` — if user has never synced, fires `runSync()` in the background (fire-and-forget).
8. Saves session, redirects to `/`.

### Logout
`POST /api/auth/logout` — calls `req.session.destroy()`, responds `{message: "Logged out successfully"}`.

### Token Refresh
`lib/spotify.ts → getValidAccessToken(tokens, userKey)` implements JIT refresh:
- If `tokens.expiresAt - Date.now() < 60_000` ms, call `refreshAccessToken(refreshToken)`.
- Uses an in-flight deduplication `Map<string, Promise>` so concurrent calls for the same user share one refresh request.
- Called in `GET /api/auth/me` and in the sync/generate flows.

## Library Sync (`routes/spotify.ts`)

### Modes
- **Full sync** (`full: true` in body): deletes all existing `liked_songs` rows for the user, fetches all pages from Spotify's `/me/tracks`, preserves any existing audio-feature values before wiping.
- **Incremental sync** (default): passes `lastSyncedAt` as a cutoff to `fetchLikedSongs()`, which stops paginating once it encounters a track older than the cutoff. Appends new rows only.

### Deduplication guard
`activeSyncs: Set<string>` prevents concurrent syncs for the same user.

### Full-sync cooldown
If a user has ≥ 500 tracks and synced within the last 6 hours, a full sync is rejected with `reason: "FULL_SYNC_COOLDOWN"`.

### Audio Features
`fetchAudioFeatures()` is called with the new track IDs after each sync. Falls back from Client Credentials token → user access token if the CC token fails. If fewer than 35% of tracks in a library have audio features after sync, a warning is logged.

After sync completes:
- `invalidateGenreProfileCache(userId)` clears the in-memory cache.
- `warmGenreProfileCache(userId, rows)` pre-computes the genre profile.

## Playlist Generation (`controllers/generation.controller.ts`)

See [Playlist Generation Flow](./playlist-generation-flow.md) for the full pipeline.

Key behaviours:
- **Rate limit**: 5 POST `/api/generate` per 60 seconds per `spotifyUserId` (in-memory `Map`).
- **Status endpoint**: `GET /api/generate/status` returns the current phase for the user's active generation as a string (e.g. `"scoring"`, `"done"`). The frontend does not currently poll this — it shows a static spinner.
- **Deterministic mode**: if `KWALIFY_DETERMINISTIC=1`, the scoring engine uses fixed seeds (for testing).

## Library Routes (`routes/library.ts`)

- `GET /api/library/summary` — aggregates `liked_songs` for the user: track count, artist count, oldest/newest `addedAt` year, top decade, genre family count. No external API calls.
- `GET /api/library/chapters` — groups liked songs into temporal "life chapters" based on gaps in `addedAt` timestamps. **This endpoint is defined but not called by any frontend page.**

## History Route (`routes/history.ts`)

`GET /api/history` — queries `playlist_history` ordered by `createdAt DESC`, returns up to 20 recent entries. Does not catch DB errors (unhandled rejection would propagate to Express error handler).

## Playlist CRUD (`controllers/playlist-crud.controller.ts`)

- `GET /api/playlists` — reads `saved_playlists` for the current user.
- `DELETE /api/playlists/:id` — deletes by `id` only if `userId` matches (ownership check).
- `GET /api/share/:id` — reads `saved_playlists` by integer `id`; **no auth required** (public share links).
- `POST /api/playlists/:id/feedback` — upserts into `playlist_feedback`. Feedback data is written but **never read back** anywhere in the codebase.

## Logging

`pino` is used throughout. Log level defaults to `"info"`. Override with `LOG_LEVEL` environment variable. In development, logs are pretty-printed; in production, JSON lines.

The `pino-http` middleware attaches `req.log` to every request, so route handlers log via `req.log.info(...)` with request context automatically included.

## Error Handling

No global error-handling middleware is registered. Unhandled promise rejections from route handlers propagate to Express's default error handler, which returns a `500` with an HTML body. Routes that call Spotify APIs generally have explicit try/catch; the `history.ts` and `library/chapters` handler do not.

## Zod Schemas (`backend/zod/api.ts`)

Defines request and response types using Zod. Note:
- `GeneratePlaylistRequest` — validated on `POST /api/generate` body.
- `GeneratePlaylistResponse` — declares `playlistId` as `z.string()` but the actual response sends an integer. **Schema drift.**
- `GetHistoryResponse` — defined but not used by `history.ts` (that handler returns plain DB rows).
- `AuthCallbackQueryParams` — defined but not validated in the callback handler (handler manually destructures `req.query`).
