# Local maintenance — Kwalify self-host (Windows)

One-page guide for keeping **kwalify.net** running from your PC with minimal fuss.

---

## Daily (30 seconds)

| Do | How |
|----|-----|
| Start | Desktop **Start Kwalify** or `start.bat` |
| Leave open | **Kwalify API** window + **Cloudflare Tunnel** window |
| Stop when done | **Stop Kwalify** or `stop-kwalify.bat` |

**Optional while hosting friends:** run `start-health-watch.bat` — restarts the tunnel if it dies (does not touch the API).

---

## When something breaks

| Symptom | Fix |
|---------|-----|
| Site down for friends | `check-beta-ready.bat` → fix red items |
| Tunnel error 1033 | `repair-tunnel.bat` or Stop → Start |
| Start script errors | Read `kwalify-start.log` |
| API errors | Read `kwalify-api.log` |
| Skip git pull on start | Create empty file `.kwalify-nopull` in project root |
| Force rebuild | `start-kwalify.bat build` |

---

## Weekly (5 minutes)

Run **`weekly-maintenance.bat`** (or `npm run maintenance:weekly`):

1. Beta readiness checklist  
2. Backup age + dump integrity  
3. Route smoke (if API is up)  
4. Saves report to `reports/maintenance-last-run.txt`

**Automate (once, as Admin):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\schedule-weekly-maintenance.ps1
```

Runs every **Sunday 10:00 AM**.

---

## Backups

| Task | Command |
|------|---------|
| Manual backup | `npm run backup:db` |
| Verify latest | `npm run maintenance:verify-backup` |
| Auto daily 3 AM | `scripts\schedule-db-backup.ps1` (Admin, once) |

Backups live in `backups\kwalify-YYYYMMDD-HHMMSS.dump`.  
**Test a restore once** before you trust them (see [PRODUCTION-CHECKLIST.md](./PRODUCTION-CHECKLIST.md)).

---

## Beta testers

1. Add their **Spotify email** in [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → User Management  
2. Send them [BETA-TESTER-GUIDE.md](./BETA-TESTER-GUIDE.md)  
3. Keep Kwalify running while they test  

---

## Desktop shortcuts

Run once: `create-kwalify-shortcuts.bat`

| Shortcut | Purpose |
|----------|---------|
| Start Kwalify | Daily start |
| Stop Kwalify | Stop API + tunnel |
| Check Beta Ready | Full checklist |
| Open Status Page | Public status |
| *(add manually)* | Pin `weekly-maintenance.bat` if you like |

---

## Logs

| File | What |
|------|------|
| `kwalify-start.log` | Launcher (rotates >2 MB) |
| `kwalify-api.log` | API (rotates >10 MB) |
| `kwalify-watchdog.log` | Health watch (if running) |
| `reports\cloudflared.log` | Tunnel |

---

## More

- [PRODUCTION-CHECKLIST.md](./PRODUCTION-CHECKLIST.md) — path from closed beta to public launch  
- [OPERATIONS.md](./OPERATIONS.md) — hardware sizing, env vars  
- [local-commands.md](./local-commands.md) — full command reference  
