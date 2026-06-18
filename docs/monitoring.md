# Monitoring and alerts

Kwalify emits structured ops metrics without requiring a specific vendor. Wire your log aggregator or uptime checker to these signals.

## In-process counters

`GET /api/ops/metrics` returns:

- `serverBusy` — total / last-hour `SERVER_BUSY` (503 queue rejections)
- `syncFailures` — total / last-hour Spotify sync failures
- `generateQueue` — active, queued, limits, average latency
- `alerts` — recent alert events (max 50)

In production this endpoint requires `x-kwalify-evaluation-token` (same as eval/audit mode).

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

**Uptime (free):** UptimeRobot or Better Stack → ping `https://kwalify.net/api/healthz` every 5 min; alert on non-200.

**Logs:** Render log stream → filter `[ops-alert]` or `alertType`. Optional: Sentry via `SENTRY_DSN` (future — hook pino transport when added).

**CI:** `.github/workflows/uptime-smoke.yml` runs deploy smoke daily and fails on health/readyz regression.

## Render

After deploy, confirm `/api/readyz` commit SHA and spot-check `/api/ops/metrics` with eval token after a busy period.
