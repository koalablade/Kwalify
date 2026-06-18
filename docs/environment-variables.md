# Environment Variables

All variables are validated at startup by `backend/lib/env.ts` via `validateEnv()`. The server will not start if required variables are missing or invalid.

## Required Variables

These must be set or the server exits immediately at startup.

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Example: `postgresql://user:pass@host:5432/dbname` |
| `SESSION_SECRET` | Secret for signing session cookies. Use a random string of at least 32 characters. |
| `PORT` | TCP port the HTTP server listens on. Must be a positive integer. Example: `5000` |

## Spotify Credentials (Conditionally Required)

These three variables must **all** be set together. If any one is missing, the `spotify` feature is disabled and all Spotify-dependent endpoints return `503 Service Unavailable`. The app boots and healthz works without them.

| Variable | Description |
|---|---|
| `SPOTIFY_CLIENT_ID` | Spotify application Client ID from the Spotify Developer Dashboard |
| `SPOTIFY_CLIENT_SECRET` | Spotify application Client Secret |
| `SPOTIFY_REDIRECT_URI` | OAuth redirect URI registered in the Spotify app settings. Must be an exact match. Example: `https://yourdomain.com/api/auth/callback` |

**Required Spotify OAuth scopes** (must be enabled in the Spotify app):
- `user-library-read` — read liked songs
- `playlist-modify-private` — create and add tracks to private playlists
- `user-read-email` — read user email (for profile)
- `user-read-private` — read user country and subscription level

## Optional Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `"development"` | Environment mode. Set to `"production"` to enable secure cookies, strict CORS, and JSON logging. |
| `APP_URL` | undefined | Canonical public origin of the app. Example: `https://kwalify.net`. Used for CORS allowed origins, session cookie `domain`, and constructing absolute share URLs. |
| `FRONTEND_URL` | undefined | Additional CORS-allowed origins. Comma-separated list of origins. Example: `https://www.kwalify.net,https://staging.kwalify.net` |

## Undocumented Variables

These variables are used in the codebase but are **not** declared or validated in `backend/lib/env.ts`.

| Variable | Default | Used In | Description |
|---|---|---|---|
| `LOG_LEVEL` | `"info"` | `backend/lib/logger.ts` | Pino log level. Values: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"` |
| `PLAYLIST_EVAL_TOKEN` | undefined | `backend/routes/eval.ts`, generation audit mode | Shared secret for eval/audit API. Must match on Render and GitHub Actions. |
| `SMOKE_SPOTIFY_USER_ID` | undefined | CI live coherence scripts | Spotify user ID for live regression (GitHub secret; optional locally). |
| `KWALIFY_DETERMINISTIC` | undefined | `backend/core/debug/stability-config.ts` | Set to `"1"` to enable deterministic mode in the scoring engine. Used for testing reproducibility. |

## Variable Interactions

### CORS Configuration
In development (`NODE_ENV !== "production"`), all origins are allowed.

In production, allowed origins are built from:
1. `APP_URL` (if set)
2. Each entry in `FRONTEND_URL` (comma-split, if set)
3. If neither is set in production, CORS will block all cross-origin requests.

### Cookie Security
| Setting | Development | Production |
|---|---|---|
| `secure` | false | true (requires HTTPS) |
| `sameSite` | none | "lax" |
| `domain` | not set | Derived from `APP_URL` if set |

### Session Cookie Domain
If `APP_URL` is set and `NODE_ENV=production`, the session cookie `domain` is set to the hostname of `APP_URL`. This allows cookies to be shared across subdomains.

## Example `.env` (Development)

```env
DATABASE_URL=postgresql://localhost:5432/kwalify
SESSION_SECRET=your-random-secret-here-at-least-32-chars
PORT=5000
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:5000/api/auth/callback
NODE_ENV=development
LOG_LEVEL=debug
```

## Example `.env` (Production)

```env
DATABASE_URL=postgresql://user:pass@db-host:5432/kwalify
SESSION_SECRET=long-random-production-secret
PORT=5000
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback
NODE_ENV=production
APP_URL=https://kwalify.net
FRONTEND_URL=https://www.kwalify.net
LOG_LEVEL=info
PLAYLIST_EVAL_TOKEN=your-shared-eval-token
```

## Replit Secrets

When deployed on Replit, environment variables are set via the Secrets panel. The `DATABASE_URL` for the built-in Replit PostgreSQL database is provisioned automatically when the database is attached to the Repl.
