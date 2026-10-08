# Deployment

## Local development (Windows — recommended)

Double-click **`KWALIFY-START.bat`** in the repo root, or read **[FIRST-TIME-SETUP.txt](../FIRST-TIME-SETUP.txt)**.

Spotify login requires **`https://kwalify.net`** (not `localhost`). The PC serves it through a
Cloudflare Tunnel set up once with **`setup-self-host.bat`**:

1. API on port **5000** (`KWALIFY-START.bat`)
2. Cloudflare tunnel started by `KWALIFY-START.bat` when `.env` has `KWALIFY_HOST_MODE=selfhost` and `deploy\cloudflared.yml` exists
3. Spotify redirect URI: `https://kwalify.net/api/auth/callback`

(The old local-domain mode — hosts entry + mkcert + HTTPS proxy on 443 — was removed.)

Stop everything: **`KWALIFY-STOP.bat`**

Desktop shortcuts: **`create-kwalify-shortcuts.bat`** (once)

`KWALIFY-START.bat local` runs without the Cloudflare tunnel. START never pulls from git; update the code yourself.

On failure: read the "Kwalify server" window.

---

## Build & run (manual)

```bash
npm ci
npm run build
npm start
```

1. `npm run build` — compiles TypeScript to `backend/dist/` (see `scripts/prepare-dist.mjs`).
2. `npm start` — runs `node backend/dist/server.js`.

Node **20.x** is the supported engine (see `.nvmrc`). `npm run test:smoke` is a quick pre-flight (12 tests, no DB).

---

## Static files

Express serves `frontend/public/` as static files. No separate frontend server is required.

SPA routes in `backend/app.ts`:

- `GET /` → `index.html`
- `GET /gallery` → `gallery.html`
- `GET /p/:id` → `playlist.html`

---

## Prerequisites

1. PostgreSQL at `DATABASE_URL`
2. Spotify Developer app with redirect URI on the allowlist
3. Environment variables — see [environment-variables.md](./environment-variables.md)

---

## Production (self-host)

Kwalify runs on your Windows PC with PostgreSQL locally and Cloudflare Tunnel for `https://kwalify.net`.

1. **`setup-self-host.bat`** once
2. **`KWALIFY-START.bat`** when you want the site live
3. Set `NODE_ENV=production`, `APP_URL`, database URL, and Spotify credentials in `.env`

See [SELF-HOST-PRODUCTION.md](./SELF-HOST-PRODUCTION.md) and [CUSTOM_DOMAIN.md](../CUSTOM_DOMAIN.md).

---

## Health checks

| Endpoint | Purpose |
|----------|---------|
| `GET /api/healthz` | Lightweight DB ping |
| `GET /api/readyz` | Full readiness (DB, Spotify config, pipeline) |

Both are unauthenticated.

---

## Schema migrations

No migration files. Schema is applied idempotently at startup via `backend/lib/db-init.ts`.

- New columns in code are created on next start
- Removed columns are **not** dropped automatically
- Data migrations must be run manually before deploying breaking schema changes

---

## Graceful shutdown

On `SIGTERM` the server stops accepting connections, waits up to 25s for in-flight requests, closes the DB pool, then exits.

---

## Production notes

| Concern | Notes |
|---------|--------|
| Rate limiting | In-memory per process |
| Sessions | PostgreSQL-backed |
| HTTPS | Terminated at Cloudflare Tunnel / local mkcert proxy |
| Logging | JSON via pino; `LOG_LEVEL=warn` in production |

---

## Deployment checklist

- [ ] `DATABASE_URL` reachable
- [ ] `SESSION_SECRET` set (32+ random chars)
- [ ] `PORT` set (5000 locally)
- [ ] Spotify credentials + redirect URI on allowlist
- [ ] `NODE_ENV=production` (public self-host)
- [ ] `APP_URL` matches public origin
