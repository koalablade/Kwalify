# Self-host production readiness

Path from **closed beta on your PC** to **reliable self-hosted production** at https://kwalify.net

---

## Your 3 daily files (unchanged)

| File | Purpose |
|------|---------|
| `start.bat` | Run every day |
| `stop-kwalify.bat` | Stop everything |
| `maintain.bat` | Weekly upkeep |

**Extra (monthly or before inviting strangers):** `production-ready.bat`

---

## Automated (repo handles this)

- [x] Start + tunnel + Health Watch (API/tunnel auto-repair)
- [x] Daily DB backup task (3 AM)
- [x] Weekly maintenance (`maintain.bat`)
- [x] Beta readiness checks
- [x] Uptime logging (`reports/uptime-check.log`)
- [x] Security hardening (CSP, auth, rate limits)
- [x] Feedback form linked in app footer

---

## You must do (manual)

### Blockers before “real” production

| # | Task | How |
|---|------|-----|
| 1 | **Spotify Extended Quota** | [Spotify Dashboard](https://developer.spotify.com/dashboard) — apply after 10+ happy testers |
| 2 | **Add testers to allowlist** | Dashboard → User Management (5/5 done for closed beta) |
| 3 | **External uptime monitor** | [UPTIME-MONITORING.md](./UPTIME-MONITORING.md) — `npm run maintenance:mark-uptime` |
| 4 | **Test backup restore once** | `npm run maintenance:test-restore` (auto-marks verified) |
| 5 | **PC never sleeps on AC** | `disable-pc-sleep-admin.bat` or Windows Settings |
| 6 | **Phone test weekly** | Full flow on mobile → `npm run maintenance:mark-phone-test` |

### Recommended

| # | Task | How |
|---|------|-----|
| 7 | **Sentry** (optional) | sentry.io free tier → `SENTRY_DSN` in `.env`, restart API |
| 8 | **Secrets backup** | Save `.env` + Cloudflare creds → `npm run maintenance:mark-secrets` |
| 9 | **Dedicated always-on PC** | Mini PC / old laptop instead of daily-driver PC |
| 10 | **Phone test weekly** | Full flow on mobile after each deploy |

---

## Recommended `.env` for self-host (8-core PC)

```
V3_PARALLEL_WORKERS=4
GENERATE_CONCURRENCY_LIMIT=2
NODE_ENV=production
KWALIFY_HOST_MODE=selfhost
KWALIFY_EXPOSURE=cloudflare
PLAYLIST_CONTRACT_WORLD_GATE=1
PLAYLIST_CONTRACT_V40=1
PLAYLIST_CONTRACT_V41=1
```

`setup-self-host.bat` and `start.bat` set these on first run. Verify on `/api/readyz` under `pipelineAuthority.playlistContract`.

**Production candidate (local):** branch `v55-committed-world` @ `0b647af`. Engine checkpoint `5fab771` (V55). **Previous known-good (live):** `434be42`. GitHub `main` is still V38 — deploy from this branch, not `origin/main`.

**Rollback:** `stop-kwalify.bat` → `git checkout 434be42` (or prior SHA) → `start.bat`. DB restore: `npm run maintenance:test-restore` / `pg_restore` from `backups/`.

**V55 note:** Atmospheric prompts get `musicalWorldId` + `hardLock` end-to-end. Compounds pass at 23–24 tracks. Cozy/lo-fi sonic clustering still weak; late night may honest-422 — acceptable for closed beta.

---

## Progress check

```bat
production-ready.bat
```

Shows automated status + manual checklist.

---

## When are you “production self-host ready”?

All true:

- [ ] Spotify login works **without** manual allowlist
- [ ] `production-ready.bat` automated section all green
- [ ] Backup restore **verified** (marker file exists)
- [ ] UptimeRobot (or similar) **alerted you** at least once and you fixed it
- [ ] 20+ generations from non-you users, &lt;10% broken
- [ ] Site ran 2 weeks with only routine `maintain.bat` fixes

---

## What we deliberately skip

- Splitting `generation.controller.ts` (maintainability only)
- Redis / multi-instance (not needed on single PC)
- Moving off self-host (optional later)

**Do not refactor the playlist engine unless quality regresses.**
