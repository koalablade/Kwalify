# Monitoring and alerts

Kwalify emits structured ops metrics without requiring a specific vendor. Wire your log aggregator or uptime checker to these signals.

## In-process counters

`GET /api/ops/metrics` returns:

- `serverBusy` — total / last-hour `SERVER_BUSY` (503 queue rejections)
- `syncFailures` — total / last-hour Spotify sync failures
- `generateQueue` — active, queued, limits, average latency
- `alerts` — recent alert events (max 50)

In production this endpoint requires `OPS_METRICS_TOKEN` via header `x-ops-metrics-token` or query `?token=`.

For a public aggregate snapshot (no token), use `GET /api/ops/summary` — used by `/status`.

## Structured log alerts

Search logs for `alert: true`:

| `alertType` | Meaning |
|-------------|---------|
| `SERVER_BUSY` | Generate queue saturated |
| `SYNC_FAILURE` | Library sync failed |
| `SERVER_BUSY_RATE` | Hourly SERVER_BUSY threshold exceeded |
| `SYNC_FAILURE_RATE` | Hourly sync failure threshold exceeded |

Env thresholds:

- `OPS_SERVER_BUSY_WARN_PER_HOUR` (default 12)
- `OPS_SYNC_FAILURE_WARN_PER_HOUR` (default 5)
- `OPS_METRICS_LOG_INTERVAL_MS` (default 300000)

## Recommended external setup

**Uptime (free):** UptimeRobot or Better Stack → ping `https://kwalify.net/api/readyz` every 5 min; alert on non-200.

**Logs (self-host):** `kwalify-api.log` in the project folder; search for `[ops-alert]` or `alertType`.

**Sentry (optional):** Set `SENTRY_DSN` and `SENTRY_ENVIRONMENT=beta` in `.env`, restart API. API 500s and process crashes are forwarded automatically.

**CI:** `.github/workflows/deploy-smoke.yml` runs deploy smoke every 6–12 hours and fails on health/readyz regression.

## Self-host spot checks

After `start.bat`, confirm `/api/readyz` on https://kwalify.net and spot-check `/api/ops/summary` (or `/api/ops/metrics` with `OPS_METRICS_TOKEN`) after a busy period.
