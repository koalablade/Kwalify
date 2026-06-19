# Benchmark environment

Permanent configuration for live benchmarks, evaluations, and regression runs.

## Root cause (previous pain)

1. **Inconsistent env var names** — scripts read `SPOTIFY_USER_ID`, `SMOKE_SPOTIFY_USER_ID`, or `PLAYLIST_EVAL_SPOTIFY_USER_ID` interchangeably; workflows only set one name.
2. **Partial workflow injection** — `nightly-eval` set only `PLAYLIST_EVAL_TOKEN`; harness also needs base URL + Spotify user id.
3. **Silent skips** — deploy smoke and coherence-live skipped eval checks when token was missing instead of failing.
4. **Hidden `.env` loading** — `verify-eval-token.mjs` loaded `.env` locally; CI never had that file.
5. **Manual CLI passthrough** — workflows duplicated `--token` / `--spotify-user-id` flags instead of standard env.
6. **Server vs script split** — `validateEnv()` is for the HTTP server only; benchmark scripts had no shared resolver.

## GitHub secrets (required)

| Secret | Purpose |
|--------|---------|
| `PLAYLIST_EVAL_TOKEN` | Audit/eval API auth (must match Render production) |
| `SMOKE_SPOTIFY_USER_ID` | Spotify user id for audit-mode `/api/generate` |

Configure: **Settings → Secrets and variables → Actions**

## Automatic injection (CI)

All live benchmark workflows use **`.github/actions/benchmark-env`**, which sets every alias scripts accept:

| Canonical (preferred) | Aliases also set |
|---------------------|------------------|
| `KWALIFY_BENCHMARK_BASE_URL` | `SMOKE_BASE_URL`, `API_BASE_URL`, `PLAYLIST_EVAL_BASE_URL`, `APP_URL` |
| `PLAYLIST_EVAL_TOKEN` | `SMOKE_EVAL_TOKEN` |
| `SMOKE_SPOTIFY_USER_ID` | `SPOTIFY_USER_ID`, `PLAYLIST_EVAL_SPOTIFY_USER_ID` |

Workflows using this action:

- `.github/workflows/live-benchmark-40m.yml`
- `.github/workflows/production-validation.yml` (live step)
- `.github/workflows/deploy-smoke.yml`
- `.github/workflows/uptime-smoke.yml`
- `.github/workflows/ci.yml` (`deploy-smoke-pr`, `coherence-live`, `nightly-eval`)

Each live job runs `npm run validate:benchmark-env` before benchmarks.

## Code module

**`backend/lib/benchmark-env.ts`** — single resolver for all live scripts:

- `resolveLiveBenchmarkCredentials()` — CLI overrides + env aliases + clear errors
- `validateBenchmarkEnvForCi()` — preflight for CI jobs
- `fetchDeployedCommit()` — auto pin preflight to production commit in CI
- `readBenchmarkEnv()` — read first non-empty alias

Scripts using it:

- `prompt-reliability-benchmark.ts`
- `playlist-evaluation-harness.ts`
- `production-validation.ts`
- `coherence-live-regression.ts`
- `deploy-smoke.ts`
- `verify-eval-token.ts`
- `diagnose-eval-token.ts`
- `validate-benchmark-env.ts`

**No `.env` auto-loading in benchmark scripts.** Local `.env` is gitignored and optional; use `npm run sync:eval-token` to write it for local shells only.

## Local runs

Export vars or use sync script:

```powershell
npm run sync:eval-token      # after setting $env:PLAYLIST_EVAL_TOKEN
npm run validate:benchmark-env
npm run verify:eval-token
```

## Validation commands

```powershell
npm run validate:benchmark-env   # fail fast if secrets missing
npm run verify:eval-token        # ping + audit generate against production
npm run diagnose:eval-token      # compare token length with production /api/eval/ping
```

## Optional / cookie-based (not in GitHub secrets)

| Variable | Used by |
|----------|---------|
| `PLAYLIST_BENCHMARK_AUTH_COOKIE` / `COOKIE_VALUE` | `scripts/live-prompt-benchmark.cjs` |
| `PLAYLIST_EVAL_AUTH_COOKIE` | harness `--live-api` mode |
| `SMOKE_AUTH_COOKIE` | deploy-smoke optional generate test |

These require a browser session and remain local-only.

## Production server

`validateEnv()` warns on startup when `NODE_ENV=production` and `PLAYLIST_EVAL_TOKEN` is unset (audit mode unavailable).

Render must have the **same** `PLAYLIST_EVAL_TOKEN` as GitHub secret, then **Manual Deploy**.
