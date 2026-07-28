# Observability runbook

Beta-essential observability for Kwalify: structured logs, in-process ops metrics, and a public status dashboard. No Grafana, Prometheus, OpenTelemetry, or Datadog.

**Important:** Ops counters are **in-memory only**. They reset on API restart. Use log files for historical traces.

## Log files (self-host)

| File | Location | Notes |
|------|----------|--------|
| `kwalify-api.log` | Project root | API stdout/stderr; rotates at 10 MB → `kwalify-api.log.old` |
| `kwalify-start.log` | Project root | Launcher failures from `start.bat` |
| `kwalify-watchdog.log` | Project root | Health watchdog restarts |
| `kwalify-benchmark.log` | Project root | Benchmark scripts only |

## Finding a failed generation

1. Get `requestId` from the user error screen, API response body, or `X-Request-Id` response header.
2. Search logs for that ID.
3. Find the single `generate_complete` line for that request.
4. Read `outcome`, `failureCode`, `failureReason`, `executionPath`, and `stages`.
5. On failures, also check `playlist_execution_trace_summary` on the next warn line.

```powershell
# From project root
Select-String -Path kwalify-api.log -Pattern "your-request-id-here"

# Completion event only
Select-String -Path kwalify-api.log -Pattern "generate_complete" | Select-String "your-request-id-here"
```

### `generate_complete` fields

| Field | Meaning |
|-------|---------|
| `requestId` | End-to-end correlation ID |
| `totalMs` | Wall time for the request |
| `queueWaitMs` | Time between queue enter and worker acquire |
| `outcome` | `success`, `partial`, or `failure` |
| `failureCode` / `failureReason` | Set on failure |
| `executionPath` | `full_pipeline`, `timeout_fallback`, `gate_failure`, etc. |
| `interpretation` | Scene, confidence, emotional arc, narrative summary (truncated) |
| `retrieval` | Strategy and pool sizes |
| `candidateCounts` | Shaped → final funnel |
| `spotify` | Request count, failures, retries, 429s |
| `stages` | interpretation / retrieval / scoring / sequencing / spotify / total ms |

## Common issues

| Symptom | Likely cause | What to check |
|---------|--------------|---------------|
| Slow generation | V3 loop or large library | `stages.scoringMs`, `stages.sequencingMs` |
| Queue overload | Too many concurrent users | `SERVER_BUSY` / `QUEUE_TIMEOUT` in `generate_complete`; `/api/ops/summary` queue depth |
| Spotify failures | Token, quota, or 429 | `spotify.failures`, `spotify.rateLimitResponses` |
| Memory pressure | Large sessions or worker pool | `/api/ops/summary` memory; restart if RSS climbs |
| Failed interpretation | `interpretWorld` or scene fallback | `interpretation.confidence`, `interpretation.sceneId` |
| Failed playlist create | Spotify playlist API | `failureCode` `SPOTIFY_*`; partial success with tracks but no URL |
| No `generate_complete` | Request never reached handler | Check middleware reject (queue/restart) or process crash |

## Useful commands (PowerShell)

```powershell
# Health
Invoke-RestMethod http://localhost:3000/api/livez
Invoke-RestMethod http://localhost:3000/api/readyz

# Public ops summary (queue, p95, failures, memory)
Invoke-RestMethod http://localhost:3000/api/ops/summary

# Full ops metrics (requires OPS_METRICS_TOKEN)
$h = @{ "x-ops-metrics-token" = $env:OPS_METRICS_TOKEN }
Invoke-RestMethod http://localhost:3000/api/ops/metrics -Headers $h

# Recent failures
Select-String -Path kwalify-api.log -Pattern '"outcome":"failure"' | Select-Object -Last 20

# Queue rejections
Select-String -Path kwalify-api.log -Pattern "SERVER_BUSY|QUEUE_TIMEOUT" | Select-Object -Last 20

# Restart (self-host)
.\stop-kwalify.bat
.\start.bat
```

## Beta support checklist

Before deep-diving a user report:

- [ ] Is `/api/readyz` returning `ready`?
- [ ] Is queue stuck (`generations.active` > 0 for minutes with no completions)?
- [ ] Are Spotify failures elevated in `/api/ops/summary`?
- [ ] Is memory RSS unusually high?
- [ ] Is P95 generation time abnormal vs typical?
- [ ] Did the API restart recently? (ops counters reset)

## `/api/ops/summary` and `/api/ops/metrics`

**In-memory only:** counters reset when the API process restarts. Use `kwalify-api.log` for historical `generate_complete` traces.

**Public:** `GET /api/ops/summary` — safe aggregates for `/status` (no token).

**Token-gated:** `GET /api/ops/metrics` — full snapshot including recent alerts.

Auth: header `x-ops-metrics-token` or query `?token=`.

Metrics include: active/queued generations, p50/p95 generation time, success/failure counts (total + last hour), Spotify failures, memory, cache hit rate, requests/minute, uptime.

## Never log

Pino redacts or hashes:

- Access/refresh tokens, session secrets, `DATABASE_URL`, client secrets
- Raw Spotify user IDs (`userId` logged as `sha256:…`)
- Eval/ops tokens

`generate_complete` does **not** log the raw user prompt. `humanNarrativeSummary` is a truncated AI interpretation (max 120 chars), not the verbatim prompt.

## Sentry

Optional. Set `SENTRY_DSN` in `.env` and restart. `captureError()` forwards to Sentry when configured.

## Env vars

| Variable | Purpose |
|----------|---------|
| `OPS_METRICS_TOKEN` | Full `/api/ops/metrics` access |
| `SENTRY_DSN` | Optional error tracking |
| `LOG_LEVEL` | `warn` default in production (`info` shows more stage logs) |
| `OPS_SERVER_BUSY_WARN_PER_HOUR` | Alert threshold (default 12) |
| `OPS_SYNC_FAILURE_WARN_PER_HOUR` | Alert threshold (default 5) |
