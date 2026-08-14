# Production checklist (self-host → public launch)

Track progress from **closed beta on your PC** to **production**. Check items off as you complete them.

---

## Phase 1 — Closed beta (you are here)

- [x] Self-host stack: `start.bat`, tunnel, stop script  
- [x] Health routes: `/api/healthz`, `/api/readyz`, `/status`  
- [x] Daily DB backups + verification script  
- [x] Beta readiness script (`production-ready.bat`)  
- [x] **5 beta testers** on Spotify allowlist  
- [ ] **Phone test** this week → `npm run maintenance:mark-phone-test` after mobile flow  
- [x] **Uptime monitor** on `https://kwalify.net/api/readyz` (UptimeRobot)  
- [x] **Restore test** verified (`reports\.backup-restore-verified`)  
- [x] Health Watch auto-starts with `start.bat` (no separate bat needed)  
- [x] Weekly maintenance scheduled (`maintain.bat` / Sundays 10 AM)  
- [x] PC: no sleep on AC  

---

## Phase 2 — Spotify gate (biggest external blocker)

- [ ] App description + screenshots ready  
- [ ] Privacy (`/privacy`) and terms (`/terms`) URLs in Spotify app settings  
- [ ] Apply for **Extended Quota Mode** / production access  
- [ ] Remove dependency on manual allowlist  

Until Spotify approves, you are in beta regardless of code quality.

---

## Phase 3 — Reliability on your PC

- [x] Health Watch while hosting (`start.bat`)  
- [x] Weekly maintenance scheduled  
- [x] PC: no sleep on AC, UPS optional  
- [x] "Site down" runbook: [LOCAL-MAINTENANCE.md](./LOCAL-MAINTENANCE.md)  

---

## Phase 4 — Leave the bedroom PC

Production means **24/7 without you**.

Pick one:

| Option | Notes |
|--------|--------|
| VPS (Hetzner, DO, etc.) | Same Node + Postgres stack |
| Dedicated mini-PC at home | Cheapest always-on; keep tunnel |
| Managed VPS (Hetzner, DO, etc.) | Same Node + Postgres stack; point tunnel or reverse proxy |

- [ ] Staging environment (even a second tunnel hostname)  
- [ ] Migrate Postgres + `.env`  
- [ ] Point Cloudflare at new origin  
- [ ] Rotate secrets (`SESSION_SECRET`, eval tokens)  

---

## Phase 5 — Public launch polish

- [ ] Sentry (`SENTRY_DSN` in `.env`) — errors now captured on 500s when enabled  
- [x] Rate limits tuned (`GENERATE_CONCURRENCY_LIMIT=2` on 8 cores)  
- [ ] Delete-account flow tested  
- [x] Feedback channel linked in app  
- [ ] Secrets backup marked → `npm run maintenance:mark-secrets`  
- [ ] Cost estimate (hosting + Spotify API usage)  

---

## Do NOT block launch on these (maintainability only)

Defer until you have scale or a second developer:

- Split `generation.controller.ts`  
- Redis sessions / distributed rate limits  
- Full API error envelope on every route  
- PNG PWA icons (SVG works)  
- Archive forensics scripts  

**Do not refactor the playlist engine** unless quality regresses.

---

## "Am I production ready?"

Run:

```bat
production-ready.bat
```

All automated checks green, plus:

1. Spotify login works **without** manual allowlist  
2. Site runs **24/7** without your laptop  
3. Backups **restore** successfully  
4. You get **alerted** when health check fails  
5. **20+** successful generations from non-you users  
6. Legal pages live; delete-account works  
7. You know monthly **cost** and max concurrent users  

---

## Quick commands

```bat
production-ready.bat
maintain.bat
npm run backup:db
npm run maintenance:verify-backup
npm run maintenance:test-restore
npm run maintenance:mark-phone-test
npm run maintenance:mark-secrets
```
