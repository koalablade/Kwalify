# Closed beta operations runbook

For 5–20 trusted testers on self-hosted Kwalify. **Engine frozen at V55** — collect evidence before any retrieval/scoring changes.

**Do not turn beta into an engineering project.** No new analytics dashboards. Use existing logs + observation. Priority: **people using Kwalify**, not infrastructure.

**Branch:** `v55-committed-world` (not `main`). **Candidate:** `0b647af`. **Do not deploy from GitHub `main`** (V38).

## Before launch

### 1. Commit and deploy

On the host:

```powershell
cd C:\Users\Kwalah\Projects\Kwalify
git pull origin v55-committed-world
.\stop-kwalify.bat
.\start.bat
```

Verify live matches candidate:

```powershell
(Invoke-RestMethod https://kwalify.net/api/readyz).commit
(Invoke-RestMethod https://kwalify.net/api/readyz).pipelineAuthority.playlistContract
```

Expect `playlistContract.worldGate/v40/v41: true`.

`start.bat` runs startup audits and, if weekly maintenance is due (>7 days since `reports\.maintenance-last-run`), backup/uptime checks before the API starts.

### 2. Environment (`.env`)

| Variable | Required for beta | Notes |
|----------|-------------------|-------|
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `SESSION_SECRET` | Yes | 32+ random chars |
| `SPOTIFY_CLIENT_ID` / `SECRET` | Yes | Spotify Developer app |
| `APP_URL` | Yes | Public URL (e.g. `https://kwalify.net`) |
| `KWALIFY_HOST_MODE=selfhost` | Yes (PC host) | Caps concurrency safely |
| `OPS_METRICS_TOKEN` | Recommended | Full `/api/ops/metrics` |
| `SENTRY_DSN` | Recommended | Error alerts; optional if you read logs daily |
| `SENTRY_ENVIRONMENT` | If using Sentry | e.g. `beta` |

### 3. Health checks

```powershell
Invoke-RestMethod http://localhost:5000/api/livez    # must be 200
Invoke-RestMethod http://localhost:5000/api/readyz   # status: ready
Invoke-RestMethod http://localhost:5000/api/ops/summary
```

Open `https://your-domain/status` — confirm queue, P95, memory panels load.

### 4. Backup verification

```powershell
npm run maintenance:verify-backup
npm run maintenance:test-restore   # run once before beta; marks verified
```

See `docs/BACKUP-RESTORE.md`.

### 5. First beta user (uncoached)

Tell them only: **"Go to kwalify.net and try it."**

Do not explain prompts, buttons, or engine behaviour. Observe hesitation and confusion — log in `docs/beta-evidence-log.md`.

### 6. Smoke test (operator)

Generate one playlist as a real user. Then:

```powershell
Select-String -Path kwalify-api.log -Pattern "generate_complete" | Select-Object -Last 3
```

Confirm one line per generate with `outcome`, `requestId`, and `stages`.

### 7. Watchdog

Confirm `kwalify-watchdog.log` is updating and uses `/api/livez` only (not `readyz` during heavy generation).

---

## When a user reports a problem

### Step 1 — Get `requestId`

From the user error screen **Reference** line, API response body, or `X-Request-Id` response header.

### Step 2 — Find `generate_complete`

```powershell
Select-String -Path kwalify-api.log -Pattern "THE-REQUEST-ID"
```

Look for the single `"event":"generate_complete"` line.

### Step 3 — Read timings

Check `totalMs`, `queueWaitMs`, and `stages` (interpretation, retrieval, scoring, sequencing, spotify).

### Step 4 — Check AI interpretation

In the same log line: `interpretation.sceneId`, `confidence`, `emotionalArc`, `humanNarrativeSummary`, `retrieval.strategy`, `candidateCounts`.

### Step 5 — Check Spotify

`spotify.failures`, `spotify.rateLimitResponses`, `failureCode` starting with `SPOTIFY_`.

Also check `/api/ops/summary` → `spotify.failuresTotal`.

### Step 6 — Categorise failure

| Category | Signals |
|----------|---------|
| Queue overload | `SERVER_BUSY`, `QUEUE_TIMEOUT`, high `queued` on status |
| Timeout | `TIMEOUT`, `timeout_fallback`, high `totalMs` |
| Spotify | `spotify.failures` > 0, `SPOTIFY_*` codes |
| Interpretation | low `confidence`, null `sceneId` |
| Gate / quality | `HUMAN_SAVEABILITY_*`, `humanSaveable: false` |
| Auth | `NOT_AUTHENTICATED` |
| Crash | No `generate_complete` — check watchdog log |

More detail: `docs/observability-runbook.md`.

---

## Common fixes

| Problem | Action |
|---------|--------|
| API not responding | `.\stop-kwalify.bat` then `.\start.bat`; check `kwalify-start.log` |
| Stuck queue (active never drops) | Restart API; check for zombie generation in logs |
| Spotify errors spike | Check Spotify status; verify token refresh; reduce concurrent users |
| High memory | Restart API; check `ops/summary` RSS; limit beta to 5 concurrent |
| Database down | `readyz` fails; check PostgreSQL service; restore from backup if needed |
| Tunnel down | Restart Cloudflare tunnel script; check `kwalify-watchdog.log` |
| Slow but succeeds | Normal for 60–120s; check `stages.scoringMs` / `sequencingMs` |

### Clear stuck generation (single user)

User sees "already generating" — wait for timeout (~90s) or restart API. Per-user session lock prevents duplicate generates.

---

## Launch checklist (printable)

- [ ] Observability commit deployed to host
- [ ] `/api/livez` and `/api/readyz` pass
- [ ] `/status` shows live metrics
- [ ] Test generate → `generate_complete` in log
- [ ] Backup verified (`maintenance:test-restore`)
- [ ] `OPS_METRICS_TOKEN` set (optional)
- [ ] `SENTRY_DSN` set (optional)
- [ ] Watchdog running
- [ ] 5 testers identified; Spotify app in Development or Extended Quota understood
- [ ] Feedback channel ready (form or Discord)
- [ ] You can grep logs by `requestId` in under 2 minutes

---

## What we learn from beta (not benchmarks)

Ask testers:

- Would you **save** this playlist?
- Would you **replay** it next week?
- Did you **regenerate**? Why?
- Any **skips** in the first 10 tracks?

Track via conversations — ops counters (`userFeedback`, generate success/failure) are supplementary only.

---

## Limits (by design)

- **2 concurrent** generations, **4 queue** (self-host defaults)
- Ops metrics **reset on restart** (in-memory)
- No worker-thread `requestId` in V3 parallel logs
- Benchmark scores ≠ save-worthiness
