# Project Structure
_A complete guide to every important folder and file. Designed for a developer seeing this codebase for the first time._

---

## Repository Root

```
kwalify/
├── artifacts/          # Deployable applications
│   ├── api-server/     # Express API + backend logic
│   └── kwalify/        # React frontend (Vite)
├── lib/                # Shared libraries (compiled, imported by artifacts)
│   ├── api-client-react/   # Generated React Query hooks for the API
│   ├── api-spec/           # OpenAPI spec (source of truth for all contracts)
│   ├── api-zod/            # Generated Zod schemas for server-side validation
│   └── db/                 # Drizzle ORM schema + database client
├── scripts/            # Utility scripts (empty)
├── pnpm-workspace.yaml # Workspace packages + shared dependency versions
├── tsconfig.base.json  # Shared TypeScript strict settings
├── tsconfig.json       # Root TypeScript solution (libs only)
├── package.json        # Root dev tooling (TypeScript, ESLint, etc.)
└── .gitignore
```

---

## `artifacts/api-server/` — The Backend

**Purpose:** Express 5 REST API. Handles OAuth, Spotify sync, playlist generation, and history.

```
artifacts/api-server/
├── src/
│   ├── index.ts            # Startup: runs session DDL, then starts server
│   ├── app.ts              # Express app: CORS, sessions, logging, routes
│   ├── lib/
│   │   ├── emotion.ts      # Emotion engine: converts vibe text → EmotionProfile
│   │   ├── logger.ts       # Pino structured logger (singleton)
│   │   ├── pg-pool.ts      # Shared PostgreSQL pool + session table DDL
│   │   ├── rate-limit.ts   # In-memory sliding window rate limiter
│   │   ├── session.ts      # TypeScript augmentation for express-session types
│   │   └── spotify.ts      # Spotify API client: OAuth, liked songs, audio features
│   └── routes/
│       ├── index.ts        # Mounts all routers under /api
│       ├── auth.ts         # GET /auth/login, GET /auth/callback, POST /auth/logout, GET /auth/me
│       ├── spotify.ts      # GET /spotify/cache-status, POST /spotify/sync
│       ├── generate.ts     # POST /generate — the main playlist generation endpoint
│       ├── history.ts      # GET /history — returns past playlists for the user
│       └── health.ts       # GET /healthz — health check
├── build.mjs               # esbuild config (bundles to dist/index.mjs)
├── package.json
└── tsconfig.json
```

### Key Files Explained

**`src/lib/emotion.ts`**
The heart of Kwalify. Converts a free-text vibe string (e.g., "late night drive, melancholy") into a structured `EmotionProfile` with five normalized 0–1 values: `energy`, `valence`, `tension`, `nostalgia`, `calm`. Uses keyword matching, intensifier detection ("very", "extremely"), negation handling ("not sad"), and scene context detection (time of day, environment, motion). Entirely rule-based — no external AI API.

**`src/lib/spotify.ts`**
Wraps the Spotify Web API. Handles:
- OAuth URL generation and code exchange
- Access token refresh (automatic when expired)
- Fetching liked songs (paginated, all pages)
- Fetching audio features (energy, valence, tempo, danceability, etc.) for batches of tracks
- Creating playlists and adding tracks

**`src/routes/generate.ts`**
The most complex route. Pipeline:
1. Auth check + rate limit check
2. Parse + validate request body (Zod)
3. Run emotion engine on vibe text
4. Load user's liked songs from DB
5. Score each song against emotion profile
6. Penalise recently used tracks
7. Limit artist repetition
8. Run quality pipeline: dead zone filter → energy smoothing → artist separation → energy arc enforcement
9. Create Spotify playlist via API
10. Save to history table
11. Return full result with tracks + emotion profile

**`src/routes/auth.ts`**
Handles the full OAuth flow:
- `/auth/login` → generates CSRF state, saves to session, redirects to Spotify
- `/auth/callback` → verifies CSRF state, exchanges code for tokens, saves user to session, redirects to `/`
- `/auth/logout` → destroys session
- `/auth/me` → returns user profile from session (refreshes token if expired)

---

## `artifacts/kwalify/` — The Frontend

**Purpose:** React SPA (Vite). Shows login page, dashboard, playlist results, and history.

```
artifacts/kwalify/
├── src/
│   ├── main.tsx            # React root: applies dark class, mounts App
│   ├── App.tsx             # QueryClient, TooltipProvider, AuthProvider, router, auth guard
│   ├── index.css           # Tailwind v4 + CSS custom properties (dark theme)
│   ├── contexts/
│   │   └── auth-context.tsx    # AuthProvider: polls /auth/me, exposes user + isAuthenticated
│   ├── pages/
│   │   ├── login.tsx           # Spotify login page (uses window.location.href, NOT hook)
│   │   ├── dashboard.tsx       # Main page: header, sync banner, generate form, results
│   │   ├── history.tsx         # Past playlists list
│   │   └── not-found.tsx       # 404 fallback
│   ├── components/
│   │   ├── kwalify/            # App-specific components
│   │   │   ├── vibe-input.tsx      # Textarea with 300-char limit and rotating placeholders
│   │   │   ├── mode-selector.tsx   # Strict / Balanced / Chaotic toggle
│   │   │   ├── length-selector.tsx # Slider: 10–50 tracks
│   │   │   ├── sync-status.tsx     # Sync banner with auto-polling and progress bar
│   │   │   ├── generate-form.tsx   # Composes input + mode + length + button + error
│   │   │   ├── playlist-results.tsx # Result card: name, emotion bars, track list, Spotify link
│   │   │   ├── track-card.tsx      # Single track row: album art, name, artist, energy, duration
│   │   │   ├── history-card.tsx    # Single history item: name, vibe, mode, track count, date
│   │   │   └── error-state.tsx     # Reusable error box with optional retry button
│   │   └── ui/                 # shadcn/ui components (design system)
│   ├── hooks/
│   │   └── use-toast.ts        # Toast notification hook
│   └── lib/
│       └── utils.ts            # cn() utility (Tailwind class merge)
├── vite.config.ts          # Vite config: React, Tailwind, path aliases, port from env
├── package.json
└── tsconfig.json
```

### Key Files Explained

**`src/App.tsx`**
Three responsibilities:
1. Provides React Query, Tooltip, and Auth context to the whole app
2. Handles the `?error=` query param after OAuth failure (shows toast, cleans URL)
3. Auth guard: `isLoading` → spinner, `!isAuthenticated` → `<LoginPage />`, authenticated → routes

**`src/contexts/auth-context.tsx`**
Calls `GET /api/auth/me` on mount using `useGetMe` hook. Exposes `user`, `isLoading`, `isAuthenticated`, and `refetch` to all child components. The 401 response (no session) sets `isAuthenticated = false` which triggers the login gate in `App.tsx`.

**`src/pages/login.tsx`**
⚠️ Uses `window.location.href = "/api/auth/login"` — not the `useAuthLogin` hook. This is intentional. The generated `useAuthLogin` hook uses `fetch()`, which would follow the 302 redirect silently and return the Spotify HTML page as a response, never navigating the browser. Direct `window.location.href` navigation is the correct approach for OAuth redirects.

**`src/components/kwalify/generate-form.tsx`**
Calls `useGeneratePlaylist` mutation with `{ data: { vibe, mode, length } }`. Note the `data` wrapper — this is required by the Orval-generated hook's type signature. Passes the result up to `DashboardPage` via `onResult` callback.

---

## `lib/` — Shared Libraries

### `lib/api-spec/`
```
lib/api-spec/
├── openapi.yaml        # THE source of truth. All API routes, request/response shapes defined here.
└── orval.config.ts     # Code generator config: generates api-client-react and api-zod from openapi.yaml
```
**Never edit generated files directly. Edit `openapi.yaml` then run `pnpm --filter @workspace/api-spec run codegen`.**

### `lib/api-client-react/`
```
lib/api-client-react/
├── src/
│   ├── generated/
│   │   ├── api.ts          # All React Query hooks (useGetMe, useGeneratePlaylist, etc.)
│   │   └── api.schemas.ts  # All TypeScript interfaces (SpotifyUser, PlaylistResult, etc.)
│   ├── custom-fetch.ts     # Fetch wrapper: credentials, base URL, error parsing, ApiError class
│   └── index.ts            # Re-exports everything
└── dist/                   # Compiled declarations (used by TypeScript across workspace)
```

### `lib/api-zod/`
```
lib/api-zod/
└── src/generated/
    └── types/              # Zod schemas matching the OpenAPI spec
        ├── playlistRequest.ts  # GeneratePlaylistBody schema used in generate route
        ├── playlistResult.ts
        └── ...
```

### `lib/db/`
```
lib/db/
├── src/
│   ├── schema/
│   │   └── kwalah.ts       # All database tables: liked_songs, playlist_history, sync_status
│   └── index.ts            # Drizzle client (reads DATABASE_URL from env), re-exports tables
├── drizzle.config.ts       # Drizzle Kit config for running migrations
└── dist/                   # Compiled declarations
```

**Database tables:**

| Table | Purpose |
|---|---|
| `liked_songs` | One row per liked track per user. Stores track metadata + audio features (energy, valence, tempo, etc.) |
| `playlist_history` | One row per generated playlist. Stores name, vibe, mode, track list, emotion profile. |
| `sync_status` | One row per user. Tracks sync state: `is_syncing`, `sync_progress`, `sync_total`, `last_synced_at`. |
| `session` | Managed by `connect-pg-simple`. One row per active browser session. Created by DDL at startup. |

---

## Data Flow Summary

```
Browser                     API Server                  External
────────                    ──────────                  ────────
Click "Connect Spotify" ──► GET /auth/login
                        ◄── 302 → Spotify OAuth URL ──► accounts.spotify.com
                                                    ◄── code + state
                        ──► GET /auth/callback
                            - verify CSRF state
                            - exchange code for tokens   Spotify Token API
                            - fetch user profile         Spotify User API
                            - save to session (PG)
                        ◄── 302 → /

GET /auth/me            ──► check session → return user
Dashboard shown         ◄──

Click "Sync now"        ──► POST /spotify/sync
                        ◄── 200 "Sync started"
                            [background task]            Spotify Liked Songs API
                            fetch all liked songs    ──► Spotify Audio Features API
                            save to liked_songs (PG)
                            update sync_status (PG)

GET /spotify/cache-status ► read sync_status (PG)
                        ◄── progress/complete

Type vibe, click Gen    ──► POST /generate
                            analyzeVibe(text)
                            read liked_songs (PG)
                            score + filter + order
                            createSpotifyPlaylist    ──► Spotify Playlists API
                            save to playlist_history (PG)
                        ◄── PlaylistResult

Click "Open in Spotify" ──────────────────────────────► Spotify app/web
```
