# Closed beta launch checklist

Use this checklist before inviting the first external testers and during the beta. Pair with [`closed-beta-runbook.md`](./closed-beta-runbook.md) and [`observability-runbook.md`](./observability-runbook.md).

---

## Before inviting testers

### Deployment

- [ ] Latest `main` pulled on host (`git pull origin main`)
- [ ] API restarted (`stop-kwalify.bat` → `start.bat`)
- [ ] Cloudflare tunnel running (if self-host)

### Health checks

- [ ] `GET /api/livez` → 200
- [ ] `GET /api/readyz` → `ready` (database connected)
- [ ] `/status` page loads and shows queue / P95 / memory
- [ ] `GET /api/ops/summary` returns JSON aggregates

### Test generation

- [ ] Log in with a beta Spotify account
- [ ] Sync library completes (or honest message if empty)
- [ ] One full prompt → playlist generated
- [ ] Spotify playlist created (or partial with clear message)
- [ ] `generate_complete` appears in `kwalify-api.log` for that request
- [ ] `requestId` from response matches log line
- [ ] No tokens, raw user IDs, or `DATABASE_URL` in that log line

### Backup and error tracking

- [ ] `npm run maintenance:test-restore` passed recently
- [ ] Backup marker / schedule confirmed on host
- [ ] `SENTRY_DSN` set (recommended) or daily log review scheduled
- [ ] `OPS_METRICS_TOKEN` set (recommended for full `/api/ops/metrics`)

### Spotify app

- [ ] All beta tester Spotify emails added to app allowlist (Development mode)
- [ ] Redirect URI matches production URL

---

## During beta

### Where to check status

| What | Where |
|------|--------|
| Public dashboard | `https://kwalify.net/status` (or `/status` on host) |
| Ops summary | `GET /api/ops/summary` |
| Full metrics | `GET /api/ops/metrics` with `x-ops-metrics-token` |
| Liveness | `GET /api/livez` |
| Readiness | `GET /api/readyz` |

### Where logs are stored (self-host)

| File | Purpose |
|------|---------|
| `kwalify-api.log` | API stdout; search for `generate_complete` |
| `kwalify-watchdog.log` | Auto-restart events |
| `kwalify-start.log` | Launcher failures |

### Investigate a failure

1. Ask user for **Reference ID** (`requestId`) from error screen or `X-Request-Id` header.
2. Search `kwalify-api.log`: `Select-String -Path kwalify-api.log -Pattern "<requestId>"`
3. Find the `generate_complete` line for that ID.
4. Read `outcome`, `failureCode`, `failureReason`, `stages`, `interpretation`, `spotify`.
5. On failure, check next `playlist_execution_trace_summary` line.
6. Classify: interpretation / retrieval / scoring / Spotify / infrastructure.

### Restart safely

```powershell
.\stop-kwalify.bat
# Wait for graceful shutdown (~100s max if generations active)
.\start.bat
# Verify /api/readyz before telling users to retry
```

---

## Incident process

When a user reports **"My playlist failed"**:

1. **Collect requestId** from user or recent logs.
2. **Find `generate_complete`** in `kwalify-api.log`.
3. **Check timings** — `totalMs`, `queueWaitMs`, `stages.*`.
4. **Check interpretation** — `interpretation.sceneId`, `confidence`, `emotionalArc`.
5. **Check Spotify** — `spotify.failures`, `spotify.rateLimitResponses`, `failureCode` starting with `SPOTIFY_`.
6. **Classify issue**:

| Signal | Category |
|--------|----------|
| Low confidence, wrong scene | Interpretation |
| Small pools, `retrieval.strategy` odd | Retrieval |
| Tracks but weak cohesion | Scoring / editorial |
| `spotify.failures` > 0 | Spotify |
| `SERVER_BUSY`, `QUEUE_TIMEOUT`, DB errors | Infrastructure |

---

## Emergency recovery

### Restart procedure

1. `.\stop-kwalify.bat`
2. Confirm no stuck `node` on port 5000
3. `.\start.bat`
4. `Invoke-RestMethod http://localhost:5000/api/readyz`

### Health verification

- `/api/livez` = process up
- `/api/readyz` = DB + dependencies OK
- `/status` = queue not stuck, memory reasonable

### Rollback procedure

1. `git log -3 --oneline` on host
2. `git checkout <previous-good-commit>`
3. `stop-kwalify.bat` → `start.bat`
4. Re-verify health + one test generate
5. After fix on `main`, `git checkout main` and `git pull`

---

## Beta monitoring rhythm

### Daily (5 min)

- Failed generations count on `/status` or ops summary
- P95 generation time spike
- Queue depth / `SERVER_BUSY` in logs
- Spotify failure counter
- New `user_feedback` log lines

### Weekly (15 min)

- Common failure codes in `generate_complete`
- Regeneration / skip patterns from feedback
- User complaints vs log classification
- Interpretation confidence on failed prompts
