# Kwalify — Self-Hosted Operations Runbook

This is the canonical operations guide for running Kwalify on your own host (bare
metal, VM, or a container you manage). It replaces earlier platform-specific
guidance for self-hosted deployments.

Kwalify is a single Node.js process (Express API + static frontend) backed by
PostgreSQL. There is no separate worker service — CPU-heavy playlist generation
runs in short-lived worker threads inside the same process.

**Quick reference:** [local-commands.md](./local-commands.md) (terminal cheat sheet) · [LOCAL-MAINTENANCE.md](./LOCAL-MAINTENANCE.md) (daily/weekly upkeep) · Start: `start.bat` · Stop: `stop-kwalify.bat` · Benchmark: `/benchmark` · Smoke: `npm run test:smoke` · Legacy port 5055 redirect is optional (not auto-started).

---

## 1. Hardware requirements

Playlist generation is CPU-bound (beam search + hill climb over candidate
playlists), run across worker threads. Sizing is driven by **CPU cores** and the
**concurrency limit**, not by request volume alone.

| Scale | Users | CPU | RAM | Disk | Notes |
|---|---|---|---|---|---|
| Dev / laptop | 1 | 4 cores | 8 GB | 5 GB | `V3_PARALLEL_WORKERS=2`, `GENERATE_CONCURRENCY_LIMIT=1` |
| Small beta (recommended) | 10–50 | **8 cores** | **16 GB** | 20 GB | `V3_PARALLEL_WORKERS=4`, `GENERATE_CONCURRENCY_LIMIT=2` |
| ~100 users | 100 | 8–12 cores | 16–24 GB | 40 GB | `GENERATE_CONCURRENCY_LIMIT=3`; watch SERVER_BUSY rate |
| ~500 users | 500 | 16 cores | 32 GB | 100 GB | Consider a second app instance behind the proxy + shared Postgres |

**Peak worker threads ≈ `V3_PARALLEL_WORKERS × GENERATE_CONCURRENCY_LIMIT`.** Keep
this at or below core count. The app logs this math and a warning at startup (see
`[worker-config]` log lines).

**Storage** is dominated by PostgreSQL (synced libraries, saved playlists,
sessions, failure analytics) and log output. Provision for DB growth + a few days
of rotated logs + local DB backups (or ship backups off-host).

---

## 2. Environment variables

Full reference: [`docs/environment-variables.md`](environment-variables.md). The
operationally important ones for a self-hosted beta:

### Required
```env
DATABASE_URL=postgresql://kwalify:password@localhost:5432/kwalify
SESSION_SECRET=<64+ random chars>       # openssl rand -hex 32
PORT=5000
NODE_ENV=production
```

### Spotify (required for generation)
```env
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=https://yourdomain.com/api/auth/callback
```

### Public origin / CORS
```env
APP_URL=https://yourdomain.com          # canonical origin; enables lax cookies + CORS
# FRONTEND_URL=https://www.yourdomain.com  # optional extra CORS origins (comma-separated)
```

### Worker / concurrency (recommended beta values)
```env
V3_PARALLEL_CANDIDATES=true             # enable worker-thread parallelism
V3_PARALLEL_WORKERS=4                   # clamp; hard ceiling is 8
GENERATE_CONCURRENCY_LIMIT=2            # concurrent generations (2–3 for 8 cores)
# GENERATE_QUEUE_LIMIT=12               # queued generations before SERVER_BUSY
# V3_PARALLEL_TASK_TIMEOUT_MS=45000     # per-worker-task hard timeout
```

### Security / ops
```env
PLAYLIST_EVAL_TOKEN=<64 hex>            # protects eval/audit endpoints; rotate with npm run rotate:eval-token
EVAL_ADMIN_ENABLED=false                # admin routes are OFF in production unless "true"
LOG_LEVEL=info                          # warn in production if logs are noisy
```

> **Never commit `.env`.** CI blocks a committed `.env`. Store secrets in the
> service environment file (e.g. `/etc/kwalify/kwalify.env`, mode `600`).

---

## 3. Startup

```bash
npm ci
npm run build          # compiles TS -> backend/dist and runs the boot gate
NODE_ENV=production node backend/dist/server.js
```

Boot sequence (see `backend/server.ts`): validate env → create pool → bind HTTP
listener (so `/healthz` responds immediately) → background schema/DB readiness →
`/readyz` flips to ready. The `[worker-config]` line is emitted once the listener
is up.

Verify:
```bash
curl -fsS http://localhost:5000/healthz     # liveness (always 200 once listening)
curl -fsS http://localhost:5000/readyz      # 200 only when DB reachable + ready
```

---

## 4. Shutdown

Send `SIGTERM` (a `SIGINT`/Ctrl-C works too). The process:
1. Stops accepting new generations (returns SERVER_BUSY-style rejection).
2. Lets in-flight generations finish within the grace window.
3. Closes the HTTP server and the PG pool, then exits 0.

**Grace window is `DEFAULT_SHUTDOWN_GRACE_MS = 100s`** (`backend/lib/shutdown.ts`),
sized above the ~90s generation hard deadline + 95s request timeout so an
in-flight generation can complete and flush its response.

> **Critical:** the process manager's stop timeout MUST be ≥ 100s, otherwise it
> will `SIGKILL` mid-generation. See systemd `TimeoutStopSec` / PM2 `kill_timeout`
> below.

---

## 5. Process manager

Use **either** systemd (recommended for a Linux host) **or** PM2. Both are
provided in [`deploy/`](../deploy). They give automatic restart, graceful
shutdown, log management, environment loading, and start-on-reboot.

### systemd
```bash
sudo useradd --system --home /opt/kwalify --shell /usr/sbin/nologin kwalify   # once
sudo cp deploy/kwalify.service /etc/systemd/system/kwalify.service
sudo install -d -o kwalify -g kwalify /etc/kwalify
sudo install -m 600 .env /etc/kwalify/kwalify.env      # your production env
sudo systemctl daemon-reload
sudo systemctl enable --now kwalify
sudo systemctl status kwalify
journalctl -u kwalify -f                                # tail logs
```
Key settings in the unit: `Restart=on-failure`, `TimeoutStopSec=110`,
`KillSignal=SIGTERM`, `EnvironmentFile=/etc/kwalify/kwalify.env`.

### PM2
```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save                     # persist process list
pm2 startup                  # print the command to enable start-on-reboot
pm2 logs kwalify
```
Key settings: `kill_timeout: 110000`, `max_restarts`, `exp_backoff_restart_delay`,
env loaded from the ecosystem file (point it at your real env).

---

## 6. Database backup & restore

Scripts live in [`scripts/`](../scripts): `backup-db.sh` (Linux/host) and
`backup-db.ps1` (Windows/dev). They produce **timestamped** compressed dumps and
fail loudly (non-zero exit + stderr) if `pg_dump` fails or `DATABASE_URL` is unset.

### Backup
```bash
# writes ./backups/kwalify-YYYYMMDD-HHMMSS.dump (custom format, compressed)
DATABASE_URL=postgresql://... ./scripts/backup-db.sh
# custom output dir + retention (keep last 14):
BACKUP_DIR=/var/backups/kwalify BACKUP_RETAIN=14 ./scripts/backup-db.sh
```
Schedule daily via cron:
```
15 3 * * *  DATABASE_URL=... BACKUP_DIR=/var/backups/kwalify /opt/kwalify/scripts/backup-db.sh >> /var/log/kwalify-backup.log 2>&1
```

### Restore
The scripts print the exact restore command. It is:
```bash
# stop the app first, then:
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" backups/kwalify-YYYYMMDD-HHMMSS.dump
# start the app; it will re-run idempotent schema bootstrap on boot.
```
Restore to a scratch DB first to validate a backup:
```bash
createdb kwalify_restore_test
pg_restore --no-owner --dbname "postgresql://.../kwalify_restore_test" backups/<file>.dump
```

> Migrations: schema is bootstrapped idempotently at boot (`runDbInit`). No
> external migration tool is required for the beta.

---

## 7. Monitoring & observability

### Error tracking
All operational errors route through `backend/lib/error-tracking.ts`
(`captureError`). Today it logs structured JSON. To add Sentry (or similar) later,
install the SDK and call `setErrorSink(...)` once in `bootstrap()` — no other code
changes needed:
```ts
import { setErrorSink } from "./lib/error-tracking";
setErrorSink((err, ctx) => Sentry.captureException(err, { extra: ctx }));
```

### Host metrics to watch
Scrape with your agent of choice (node_exporter + Prometheus/Grafana, netdata,
`systemd`/`pm2` built-ins). Minimum signals:

| Metric | Why | Alert hint |
|---|---|---|
| CPU utilisation | Generation is CPU-bound; sustained ~100% ⇒ raise cores or lower concurrency | > 85% for 5 min |
| RAM / swap | Worker threads + PG; OOM kills the process | > 85% used, or any swap |
| Disk usage | PG + logs + backups | > 80% |
| Process uptime | Detect crash loops | uptime resets frequently |
| Restart count | systemd `NRestarts` / PM2 `restarts` | > 3 / hour |

### App signals (in logs)
- `[worker-config]` — startup worker/concurrency summary + oversubscription warnings.
- `[ops-alert] SERVER_BUSY rate elevated` — sustained queue pressure (tune
  `GENERATE_CONCURRENCY_LIMIT` / add cores). Threshold: `OPS_SERVER_BUSY_WARN_PER_HOUR`.
- `[process] Unhandled promise rejection` — logged, process continues (investigate).
- `[process] Uncaught exception — exiting` — fatal; the process manager restarts.

### Health endpoints
| Endpoint | Meaning | Use for |
|---|---|---|
| `GET /healthz` | Liveness — 200 as soon as the listener is up | process-manager liveness |
| `GET /readyz` (alias `GET /readiness`) | Readiness — 200 only when runtime ready **and** a live `SELECT 1` succeeds | load-balancer readiness gate |

`/readyz` body includes `checks.{databaseAvailable, spotifyConfigured,
pipelineAvailable}` for quick diagnosis.

---

## 8. Recovery procedures

| Symptom | Action |
|---|---|
| Process crash-looping | `journalctl -u kwalify -n 200` / `pm2 logs`; look for fatal boot error (env/DB). Fix env or DB, restart. |
| `/readyz` 503, DB down | Check Postgres up + reachable; `DATABASE_URL` correct; `checks.databaseAvailable` in body. |
| High SERVER_BUSY rate | Lower `GENERATE_CONCURRENCY_LIMIT` or add CPU; confirm `[worker-config]` isn't warning about oversubscription. |
| OOM / swap | Reduce `V3_PARALLEL_WORKERS` and/or `GENERATE_CONCURRENCY_LIMIT`; add RAM. |
| Corrupt/lost data | Restore latest good dump (§6); app re-bootstraps schema on start. |
| Secret leaked | `npm run rotate:eval-token`; rotate `SESSION_SECRET` (invalidates sessions) and Spotify secret. |
```
