# Health checks and on-call runbook

## Liveness — `GET /api/healthz`

- Returns `200` when the Node process is up.
- Does **not** check PostgreSQL or session store.
- Use for platform restart probes only.

## Readiness — `GET /api/readyz`

- Returns `200` with `readiness: "ready"` when bootstrap completed and runtime is ready.
- Returns `503` with `SERVER_STARTING` while DB/session/schema initialization is in flight.
- Use for traffic routing — do not send user traffic when readiness is not `ready`.

## Deploy smoke

```bash
npm run smoke:deploy
```

Validates healthz, readyz, deployment commit, eval ping, CORS, and launch pages.

## Alerts (recommended)

| Signal | Source | Action |
|--------|--------|--------|
| `SERVER_BUSY` rate | API logs / metrics | Scale Render instance or lower generate concurrency |
| Sync failures | `sync_status` stuck + error logs | Check Spotify API status, token refresh |
| p95 generate latency | production validation harness | Profile stage timings, library size |

## Graceful shutdown

SIGTERM triggers a bounded shutdown window (~25s). Deploy smoke should be run after deploy to confirm readiness returns within 60s.
