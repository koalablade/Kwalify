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
| `PLAYLIST_EVAL_TOKEN` | undefined | `backend/routes/eval.ts`, generation audit mode | Shared secret for eval/audit API. Rotate with `npm run rotate:eval-token`. Compared in constant time. |
| `EVAL_ADMIN_ENABLED` | `false` (prod) | `backend/routes/eval-admin.ts` | Admin routes (`/api/eval/admin/*`) are disabled in production unless set to `"true"`. Non-production always enabled. Disabled routes return 404. |
| `V3_PARALLEL_CANDIDATES` | disabled | `backend/lib/v3-worker-pool.ts` | `"true"`/`"1"` enables worker-thread parallelism for candidate generation. |
| `V3_PARALLEL_WORKERS` | `min(cores-1, 8)` | `backend/lib/v3-worker-pool.ts` | Worker lanes per generation. Clamped to a hard ceiling of 8. Recommended beta value: `4`. |
| `V3_PARALLEL_TASK_TIMEOUT_MS` | `45000` | `backend/lib/v3-worker-pool.ts` | Per-worker-task hard timeout; a timed-out task recomputes on the main thread. |
| `GENERATE_CONCURRENCY_LIMIT` | `4` | `backend/lib/runtime-overload.ts` | Concurrent generations allowed. Recommended `2`–`3` on an 8-core beta host. |
| `GENERATE_QUEUE_LIMIT` | `12` | `backend/lib/runtime-overload.ts` | Queued generations before requests are rejected with `SERVER_BUSY`. |
| `SMOKE_SPOTIFY_USER_ID` | undefined | CI live coherence scripts | Spotify user ID for live regression (GitHub secret; optional locally). |
| `KWALIFY_DETERMINISTIC` | undefined | `backend/core/debug/stability-config.ts` | Set to `"1"` to enable deterministic mode in the scoring engine. Used for testing reproducibility. |
| `KWALIFY_CACHE_ENTRY_BUDGET` | `1200` | `backend/lib/cache-memory-budget.ts` | Total in-process cache entry budget shared across generate-result, genre-stack, and session-snapshot caches. |
| `BENCHMARK_UI_TOKEN` | undefined | `backend/middleware/benchmark-auth.ts` | Shared secret for remote benchmark mutations. Send as `x-benchmark-ui-token` header when not on loopback. |
| `OPS_METRICS_TOKEN` | undefined | `backend/lib/ops-metrics-auth.ts` | Required bearer token for `/api/ops/metrics` in production. |
| `EVAL_ALLOWED_SPOTIFY_USER_IDS` | undefined (falls back to `SMOKE_SPOTIFY_USER_ID`) | `backend/lib/eval-token.ts`, generation audit mode | Comma-separated Spotify user IDs allowed to use eval token routes. |
| `GLOBAL_RATE_LIMIT_PER_MINUTE` | `60` | `backend/lib/global-rate-limit.ts` | Per-client request cap per minute. Uses `CF-Connecting-IP` when behind Cloudflare. |
| `GLOBAL_RATE_LIMIT_BURST` | `20` | `backend/lib/global-rate-limit.ts` | Short burst cap within `GLOBAL_RATE_LIMIT_BURST_WINDOW_MS`. |
| `PLAYLIST_CONTRACT_WORLD_GATE` | `off` | `backend/core/playlist-contract/feature-flag.ts` | V39: defer hard world lock when contract disagrees with committed world. Set `1` for production compound-intent behavior. |
| `PLAYLIST_CONTRACT_V40` | `off` | `backend/core/playlist-contract/feature-flag.ts` | V40: contract-authoritative retrieval when world gate defers. Requires `PLAYLIST_CONTRACT_WORLD_GATE=1`. |
| `PLAYLIST_CONTRACT_V41` | `off` | `backend/core/playlist-contract/feature-flag.ts` | V41: contract-aware composition when gate defers (`sad but party`, `preserve_both`). Requires V39+V40 for full path. |
| `PLAYLIST_CONTRACT_SHADOW` | `off` | `backend/core/playlist-contract/feature-flag.ts` | Build contract + log disagreements without changing output. |
| `PLAYLIST_CONTRACT_RETRIEVAL` | `off` | `backend/core/playlist-contract/feature-flag.ts` | Rerank retrieval pool by contract score (experimental). |
| `PLAYLIST_CONTRACT_VALIDATION` | `off` | `backend/core/playlist-contract/feature-flag.ts` | Terminal contract audit. Values: `shadow`, `enforce`, or `1`. |

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

## Example `.env` (Local Windows — kwalify.net)

Used by `start-kwalify.bat` (domain mode). Spotify login requires this URL, not localhost.

```env
DATABASE_URL=postgresql://kwalify:kwalify@localhost:5432/kwalify
SESSION_SECRET=your-random-secret-here-at-least-32-chars
PORT=5000
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback
NODE_ENV=development
APP_URL=https://kwalify.net
LOG_LEVEL=debug
```

Debug-only (no Spotify login): run `start-kwalify.bat local` — uses `http://localhost:5000`.

## Example `.env` (Development — generic)

```env
DATABASE_URL=postgresql://localhost:5432/kwalify
SESSION_SECRET=your-random-secret-here-at-least-32-chars
PORT=5000
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback
NODE_ENV=development
APP_URL=https://kwalify.net
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

## Production secrets (self-host)

Set environment variables in `.env` on the host PC. Use local PostgreSQL — see [deployment.md](./deployment.md) and [SELF-HOST-PRODUCTION.md](./SELF-HOST-PRODUCTION.md).
