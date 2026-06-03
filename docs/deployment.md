# Deployment

## Build & Run

### Development

```bash
npm run dev
```
Runs `ts-node` (or `tsx`) directly from source — no compile step. TypeScript errors are reported at runtime.

### Production

```bash
npm run build && npm start
```

1. `npm run build` — runs `tsc` to compile `backend/` → `dist/`. Output is CommonJS.
2. `npm start` — runs `node dist/server.js`.

The workflow configured in this Replit is:
```
npm run build && npm start
```
on port `5000`.

## Static Files

The Express server serves `frontend/public/` as static files. No separate web server (nginx, etc.) is needed. All routes unknown to the static middleware fall through to the API router or return 404.

SPA routing is handled by explicit `res.sendFile()` handlers in `app.ts` for:
- `GET /` → `index.html`
- `GET /gallery` → `gallery.html`
- `GET /p/:id` → `playlist.html`

## Prerequisites

Before deployment:
1. A PostgreSQL database must be accessible at `DATABASE_URL`.
2. Spotify Developer App must be created at [developer.spotify.com](https://developer.spotify.com) with the correct `Redirect URI` added to the app's allowlist.
3. All required environment variables must be set (see [Environment Variables](./environment-variables.md)).

## Replit Deployment

This project is designed to run on Replit.

1. Attach a Replit PostgreSQL database — `DATABASE_URL` is automatically set.
2. Set secrets in the Replit Secrets panel:
   - `SESSION_SECRET`
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `SPOTIFY_REDIRECT_URI` (must match the callback URL for your Repl's public domain)
3. The `Start application` workflow runs `npm run build && npm start` on port 5000.
4. Click "Deploy" in the Replit UI to publish to a `.replit.app` domain.

When deployed, the `SPOTIFY_REDIRECT_URI` must be set to `https://your-repl-name.replit.app/api/auth/callback` and this exact URI must be added to the Spotify app's redirect URI allowlist.

## Health Check

`GET /api/healthz` returns `{"status":"ok"}` with HTTP 200. This endpoint is unauthenticated and has no external dependencies (it does not query the database). Use this for uptime monitoring or load balancer health checks.

If deeper health checking (database connectivity) is required, a query must be added to this handler.

## Schema Migrations

There are no migration files. The schema is applied via idempotent DDL in `backend/lib/db-init.ts`, which runs at every server startup via `runDbInit()` in the bootstrap sequence. This means:
- Columns that have been added in code will be created on next deploy.
- Columns that have been removed from code will remain in the database (no automatic drops).
- Schema changes that require data migration (e.g., changing a column type) must be applied manually to the database before deploying the new code.

## Graceful Shutdown

The server listens for `SIGTERM` and:
1. Stops accepting new connections.
2. Waits up to 25 seconds for active requests to complete.
3. Closes the `pg.Pool`.
4. Exits with code 0.

Replit's deployment infrastructure sends `SIGTERM` before stopping a container. Active long-running requests (library sync, generation) will be abandoned if they exceed the 25-second window.

## Production Considerations

| Concern | Current State | Notes |
|---|---|---|
| Rate limiting | In-memory per-process | Resets on restart; not shared across multiple instances |
| Active syncs | In-memory `Set` | Resets on restart; user may sync again after restart |
| Session store | PostgreSQL | Survives restarts |
| Audio features | Preserved across full syncs | Protects against Spotify 403s on bulk requests |
| HTTPS | Handled by Replit proxy | Do not terminate TLS in the app |
| Logging | JSON (pino) | Structured logs; use `LOG_LEVEL=warn` in production for lower volume |

## Environment Checklist for Deployment

- [ ] `DATABASE_URL` set and database reachable
- [ ] `SESSION_SECRET` set (long random string, not committed to source control)
- [ ] `PORT` set (Replit expects 5000)
- [ ] `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` set
- [ ] `SPOTIFY_REDIRECT_URI` added to Spotify app's redirect URI allowlist
- [ ] `NODE_ENV=production`
- [ ] `APP_URL` set to the public domain (for CORS and cookie domain)
