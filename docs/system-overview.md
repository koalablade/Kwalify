# System Overview

## What Kwalify Is

Kwalify is a Spotify playlist generation web app. Users authenticate with Spotify, describe a mood or moment in plain text ("late-night motorway drive"), and the app generates a private Spotify playlist drawn entirely from their own Liked Songs library. No new music is recommended — every track is one the user has already saved.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| HTTP framework | Express 5 (RC) |
| Language | TypeScript (compiled to `dist/`) |
| ORM | Drizzle ORM (`drizzle-orm/node-postgres`) |
| Database | PostgreSQL (connection string via `DATABASE_URL`) |
| Session store | `connect-pg-simple` — sessions persisted in the `session` PG table |
| Logging | `pino` with `pino-http` per-request logging |
| Frontend | Vanilla JS ES modules, no build step |

## Repository Structure

```
/
├── backend/
│   ├── app.ts                    # Express app factory — middleware, routes, CORS
│   ├── server.ts                 # bootstrap() entry-point + HTTP listen
│   ├── routes/
│   │   ├── index.ts              # Mounts all routers under /api
│   │   ├── auth.ts               # OAuth login / callback / logout / me
│   │   ├── spotify.ts            # Library sync (cache-status, sync)
│   │   ├── library.ts            # Library summary + chapters
│   │   ├── history.ts            # Generation history
│   │   └── health.ts             # GET /api/healthz
│   ├── controllers/
│   │   ├── generation.controller.ts   # POST /api/generate (core engine, ~1150 lines)
│   │   └── playlist-crud.controller.ts # GET/DELETE /api/playlists, share, feedback
│   ├── core/
│   │   └── scoring-engine/       # Track-scoring pipeline
│   ├── lib/
│   │   ├── env.ts                # Env-var validation + feature flags
│   │   ├── pg-pool.ts            # pg.Pool singleton + session table DDL
│   │   ├── spotify.ts            # Spotify API client (OAuth, sync, audio features)
│   │   ├── session.ts            # express-session TypeScript augmentations
│   │   ├── logger.ts             # Pino logger factory
│   │   ├── boot-state.ts         # assertBootReady() guard
│   │   ├── public-url.ts         # Constructs absolute URLs from env vars
│   │   └── genre-profile-cache.ts # In-memory genre profile cache
│   ├── db/
│   │   ├── index.ts              # Drizzle singleton + exports
│   │   └── schema/
│   │       └── kwalah.ts         # Drizzle table definitions
│   └── zod/
│       └── api.ts                # Zod request/response schemas
├── frontend/
│   └── public/
│       ├── index.html            # Main SPA shell
│       ├── gallery.html          # Gallery page shell
│       ├── playlist.html         # Share page shell
│       ├── pages/
│       │   ├── app.js            # Main SPA (landing + app, ~595 lines)
│       │   ├── gallery.js        # Gallery page (~133 lines)
│       │   └── playlist.js       # Public share page (~117 lines)
│       └── styles/
│           └── base.css          # All styles (~1023 lines)
└── docs/                         # This documentation
```

## Request Path (Happy Path)

```
Browser
  └─► Express (port 5000)
        ├─► pino-http logging
        ├─► express-session (PG-backed)
        ├─► CORS
        ├─► /api/...  routes
        │     └─► Session auth check (manual per-route)
        │     └─► Controller logic
        │           └─► Drizzle ORM ──► PostgreSQL
        │           └─► Spotify API (via lib/spotify.ts)
        └─► Static files  ──► frontend/public/
```

## Bootstrap Sequence

`server.ts` runs a sequential `bootstrap()` function before the HTTP server starts accepting connections:

1. **Validate environment** — `validateEnv()` reads and type-checks all env vars; fails fast if `DATABASE_URL`, `SESSION_SECRET`, or `PORT` are missing.
2. **Initialise DB pool** — `initPool(DATABASE_URL)` creates the singleton `pg.Pool`.
3. **Initialise Drizzle** — `initDb(pool)` wraps the pool in a Drizzle ORM instance.
4. **Run schema DDL** — `runDbInit()` executes idempotent `CREATE TABLE IF NOT EXISTS` statements for all application tables and the session table.
5. **Mark boot ready** — `markBootReady()` unlocks the `db` and `pool` proxies so route handlers can use them.
6. **Start HTTP server** — `app.listen(PORT)`.

If any step 1–4 fails, the process exits immediately and the HTTP server never starts.

## Key Design Decisions

- **No auth middleware** — Authentication is checked with a manual `if (!req.session.spotifyUserId)` guard at the top of each protected handler. There is no global `requireAuth` middleware.
- **Spotify is optional at startup** — The app boots and serves requests even without Spotify credentials. All Spotify-dependent endpoints return `503 Service Unavailable` when `SPOTIFY_CLIENT_ID/SECRET/REDIRECT_URI` are not set.
- **Boot-locked proxies** — `db` and `pool` are JavaScript `Proxy` objects that call `assertBootReady()` before every property access, preventing any code from touching the database before bootstrap completes.
- **In-memory rate limiting** — Generation is rate-limited to 5 requests per 60 seconds per Spotify user ID using a `Map<string, number[]>`. This resets on server restart.
- **No build step for frontend** — The frontend is plain ES modules served directly as static files with no bundler, transpiler, or framework.
