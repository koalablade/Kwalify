# Local command cheat sheet

Single reference for running Kwalify from a terminal when Cursor (or any IDE) is unavailable.

**Project root:** the folder containing `start.bat` (or `start-kwalify.bat`) and `package.json`

**Windows (recommended):** double-click `start.bat` — see [FIRST-TIME-SETUP.txt](../FIRST-TIME-SETUP.txt).

**Shell note (PowerShell):** run commands one at a time, or use `;` instead of `&&`.

---

## First-time setup

```powershell
cd path\to\Kwalify
# Or just double-click start.bat (handles npm ci, build, certs, hosts)
npm ci
npm run build
```

Optional: `create-kwalify-shortcuts.bat` for Desktop Start/Stop icons.

Copy `.env.example` to `.env` if the launcher has not created one yet.

---

## Dev and build

| Task | Command |
|------|---------|
| **Start Kwalify (Windows)** | `start.bat` |
| **Stop Kwalify** | `stop-kwalify.bat` |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Start (after build) | `npm start` |
| Static smoke (no server) | `npm run smoke:static` |

Production locally:

```powershell
npm run build; npm start
```

---

## Health checks (production)

| Endpoint | Purpose |
|----------|---------|
| `GET https://kwalify.net/api/healthz` | Process up |
| `GET https://kwalify.net/api/readyz` | Ready for traffic (shows commit) |
| `GET https://kwalify.net/api/eval/ping` | Deployed + eval route up |
| `POST https://kwalify.net/api/eval/ping` | Eval token check (header below) |

Eval ping headers (either works): `x-eval-token` or `x-kwalify-evaluation-token`.

Deploy smoke (needs token + Spotify user id in env):

```powershell
$env:SMOKE_BASE_URL = "https://kwalify.net"
$env:PLAYLIST_EVAL_TOKEN = "<from Render or .env>"
$env:SMOKE_SPOTIFY_USER_ID = "koalablade"
npm run smoke:deploy
```

More detail: [runbooks/health-checks.md](./runbooks/health-checks.md)

---

## Eval token sync (Render ↔ GitHub ↔ local)

**Full reference:** [benchmark-environment.md](./benchmark-environment.md)

**GitHub secrets (auto-injected in CI via `.github/actions/benchmark-env`):**

- `PLAYLIST_EVAL_TOKEN`
- `SMOKE_SPOTIFY_USER_ID`

**Preflight (local or CI):**

```powershell
npm run validate:benchmark-env
npm run verify:eval-token
npm run diagnose:eval-token
```

---

## Local CI (no live API)

Fast gates you can run offline or with only a build:

```powershell
npm run typecheck
npm run build
npm run ci:frontend-modules
npm run ci:prompt-reliability-local
npm run ci:prompt-reliability -- --require-reports --local-fixture `
  --benchmark reports/prompt-reliability/local/prompt-reliability-report.json `
  --regression reports/prompt-reliability/local/regression-report.json `
  --baseline reports/prompt-reliability/local/local-baseline.json
npm run ci:convergence-overlap -- --report reports/prompt-reliability/local/regression-report.json
npm run ci:semantic-scenes
npm run smoke:shutdown
```

Coherence fixture suite:

```powershell
npm run coherence:intent
npm run coherence:playlist
npm run coherence:world-boundary
npm run coherence:uk-hip-hop
npm run coherence:taxonomy
npm run coherence:semantic-collisions
npm run coherence:electronic-subgenres
npm run coherence:recovery-finalization
```

---

## Live benchmarks (production)

### Option A — GitHub Actions (~40 min, recommended)

Uses repo secrets; no local token needed.

```powershell
gh workflow run live-benchmark-40m.yml -R koalablade/Kwalify
gh run list -R koalablade/Kwalify --workflow=live-benchmark-40m.yml --limit 3
gh run watch <run-id> -R koalablade/Kwalify --interval 60
```

Workflow: `.github/workflows/live-benchmark-40m.yml`  
Reports: Actions run → **Artifacts** → `prompt-reliability-live-<run-id>`

### Option B — Prompt reliability (local, ~40 min)

25 prompts, audit mode. Requires eval token + synced Spotify user.

```powershell
$env:PLAYLIST_EVAL_TOKEN = "<token>"
$env:SMOKE_SPOTIFY_USER_ID = "koalablade"

# Resolve deployed commit first (preflight expects match)
$ping = Invoke-RestMethod https://kwalify.net/api/eval/ping
$commit = $ping.commit

npm run benchmark:prompt-reliability -- `
  --base-url https://kwalify.net `
  --spotify-user-id koalablade `
  --token $env:PLAYLIST_EVAL_TOKEN `
  --expected-deployment-version $commit `
  --out reports/prompt-reliability/live-manual `
  --delay-ms 2000 `
  --timeout-ms 120000
```

Useful flags: `--limit N`, `--group "Electronic"`, `--dry-run`, `--help`

Output: `reports/prompt-reliability/<out>/prompt-reliability-report.json` (+ `.md`)

### Option C — Live prompt stress suite (cookie auth)

Uses logged-in session cookie, not eval token.

```powershell
$env:COOKIE_VALUE = "<connect.sid value from browser>"
# or: $env:PLAYLIST_BENCHMARK_AUTH_COOKIE = "connect.sid=...; other=..."

node scripts/live-prompt-benchmark.cjs `
  --base-url https://kwalify.net `
  --out reports/live-playlist-benchmark/manual-run `
  --limit 23 `
  --delay-ms 13000
```

`--resume` continues from `raw-results.json` in the output folder.

### Option D — Production validation (load / SLO)

```powershell
$env:PLAYLIST_EVAL_TOKEN = "<token>"
npm run validation:production -- `
  --base-url https://kwalify.net `
  --spotify-user-id koalablade `
  --token $env:PLAYLIST_EVAL_TOKEN `
  --requests 20 `
  --concurrency 5 `
  --enforce-slo
```

Dry run (no HTTP): `npm run validation:production -- --dry-run`

### Option E — Live coherence regression (2 prompts, quick)

```powershell
$env:SMOKE_BASE_URL = "https://kwalify.net"
$env:PLAYLIST_EVAL_TOKEN = "<token>"
$env:SMOKE_SPOTIFY_USER_ID = "koalablade"
npm run regression:coherence-live
```

### Option F — Overnight evaluation harness

```powershell
$env:PLAYLIST_EVAL_TOKEN = "<token>"
$env:PLAYLIST_EVAL_SPOTIFY_USER_ID = "koalablade"
$env:PLAYLIST_EVAL_BASE_URL = "https://kwalify.net"
npm run evaluation:overnight
# resume after interrupt:
npm run evaluation:overnight:resume
```

---

## Deploy and git

```powershell
git status
git pull origin main
npm run build
npm run typecheck

# Push (after commit)
git push origin main
```

Trigger other CI workflows:

```powershell
gh workflow run production-validation.yml -R koalablade/Kwalify
gh workflow run coherence-regression.yml -R koalablade/Kwalify
```

Render auto-deploys from `main`. Confirm commit on prod:

```powershell
(Invoke-RestMethod https://kwalify.net/api/readyz).commit
```

Setup reference: [deployment.md](./deployment.md), [SELF-HOST-PRODUCTION.md](./SELF-HOST-PRODUCTION.md)

---

## Reports location

All under `reports/` (gitignored — generated locally or downloaded from Actions artifacts):

| Path | Source |
|------|--------|
| `reports/prompt-reliability/local/` | `ci:prompt-reliability-local` |
| `reports/prompt-reliability/live-*` | Live benchmark |
| `reports/live-playlist-benchmark/` | Cookie-based stress suite |
| `reports/playlist-evaluation/` | Overnight harness |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Benchmark preflight: commit mismatch | Pass `--expected-deployment-version` from `/api/eval/ping`, or deploy latest `main` |
| `tokenAccepted: false` / 403 | Token in `.env` ≠ GitHub secret; restart API after env change; run `npm run verify:eval-token` |
| PowerShell `&&` error | Use `;` or separate lines |
| Missing `PLAYLIST_EVAL_TOKEN` locally | Set env var or add to `.env`; use `npm run sync:eval-token` |
| Blank homepage after JS change | `npm run ci:frontend-modules` |

---

## Full npm script index

Run `npm run` with no args to list all scripts. Common groups:

- **CI:** `ci:prompt-reliability*`, `ci:frontend-modules`, `ci:convergence-overlap`, `ci:semantic-scenes`
- **Coherence:** `coherence:*`
- **Benchmark:** `benchmark:smoke`, `benchmark:prompt-reliability`, `benchmark:pairwise-signatures`, `benchmark:semantic-scenes` (via package)
- **Regression:** `regression:prompt-reliability`, `regression:playlists`, `regression:coherence-live`
- **Ops:** `smoke:deploy`, `smoke:static`, `smoke:shutdown`, `test:smoke`, `test:benchmark-bats`, `maintenance:weekly`, `maintenance:verify-backup`
- **Ops:** `validation:production`, `audit:*`, `quality:*`, `backfill:audio-features`
