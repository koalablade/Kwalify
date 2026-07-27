# Production checklist (self-host → public launch)

Track progress from **closed beta on your PC** to **production**. Check items off as you complete them.

---

## Phase 1 — Closed beta (you are here)

- [x] Self-host stack: `start.bat`, tunnel, stop script  
- [x] Health routes: `/api/healthz`, `/api/readyz`, `/status`  
- [x] Daily DB backups + verification script  
- [x] Beta readiness script (`check-beta-ready.bat`)  
- [ ] **5–10 real testers** with feedback logged  
- [ ] Each tester added to **Spotify User Management**  
- [ ] One **phone test** per week after changes  
- [ ] **Uptime monitor** on `https://kwalify.net/api/healthz` (UptimeRobot, etc.)  
- [ ] **Restore test**: restore one backup to confirm dumps work  

---

## Phase 2 — Spotify gate (biggest external blocker)

- [ ] App description + screenshots ready  
- [ ] Privacy (`/privacy`) and terms (`/terms`) URLs in Spotify app settings  
- [ ] Apply for **Extended Quota Mode** / production access  
- [ ] Remove dependency on manual allowlist  

Until Spotify approves, you are in beta regardless of code quality.

---

## Phase 3 — Reliability on your PC

- [ ] `start-health-watch.bat` while hosting sessions  
- [ ] Weekly maintenance scheduled (`schedule-weekly-maintenance.ps1`)  
- [ ] PC: no sleep on AC, UPS optional  
- [ ] Document “site down” runbook for yourself ([LOCAL-MAINTENANCE.md](./LOCAL-MAINTENANCE.md))  

---

## Phase 4 — Leave the bedroom PC

Production means **24/7 without you**.

Pick one:

| Option | Notes |
|--------|--------|
| VPS (Hetzner, DO, etc.) | Same Node + Postgres stack |
| Render / Fly.io | Less ops; you have `render.yaml` history |
| Dedicated mini-PC at home | Cheapest always-on; keep tunnel |

- [ ] Staging environment (even a second tunnel hostname)  
- [ ] Migrate Postgres + `.env`  
- [ ] Point Cloudflare at new origin  
- [ ] Rotate secrets (`SESSION_SECRET`, eval tokens)  

---

## Phase 5 — Public launch polish

- [ ] Sentry errors reviewed weekly  
- [ ] Rate limits tuned (`GENERATE_CONCURRENCY_LIMIT` 2–3 on 8 cores)  
- [ ] Delete-account flow tested  
- [ ] Feedback channel linked in app  
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

## “Am I production ready?”

All must be true:

1. Spotify login works **without** manual allowlist  
2. Site runs **24/7** without your laptop  
3. Backups **restore** successfully  
4. You get **alerted** when health check fails  
5. **20+** successful generations from non-you users  
6. Legal pages live; delete-account works  
7. You know monthly **cost** and max concurrent users  

---

## Quick commands

```powershell
check-beta-ready.bat
weekly-maintenance.bat
npm run backup:db
npm run maintenance:verify-backup
start-health-watch.bat    # optional, while hosting
```
