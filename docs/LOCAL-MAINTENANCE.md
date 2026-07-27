# Local maintenance — Kwalify self-host (Windows)

## The 3 files you need

| File | When |
|------|------|
| **`start.bat`** | Every day — starts site, tunnel, and **Health Watch** (auto-repairs API + tunnel) |
| **`stop-kwalify.bat`** | When done — stops everything |
| **`maintain.bat`** | Once a week — readiness, backups, routes |

Read **`START-HERE.txt`** at the project root.

---

## Daily (one double-click)

**`start.bat`** — that's it.

Health Watch runs minimized in the background. It will:
- Restart the **API** if it crashes (max once per 10 minutes)
- Restart the **Cloudflare tunnel** if friends can't reach the site

To skip Health Watch: `start-kwalify.bat nowatch`

---

## When something breaks

| Symptom | Fix |
|---------|-----|
| Site down for friends | `stop-kwalify.bat` then `start.bat` |
| Start script errors | Read `kwalify-start.log` |
| Auto-repair issues | Read `kwalify-watchdog.log` |
| API errors | Read `kwalify-api.log` |
| Skip git pull on start | Create empty `.kwalify-nopull` in project root |

You do **not** need `repair-tunnel.bat` or `start-health-watch.bat` unless debugging — `start.bat` handles both.

---

## Weekly

**`maintain.bat`** (or `npm run maintenance:weekly`)

Automate (Admin once): `scripts\schedule-weekly-maintenance.ps1`

---

## Backups

| Task | Command |
|------|---------|
| Manual backup | `npm run backup:db` |
| Verify latest | `npm run maintenance:verify-backup` |
| Auto daily 3 AM | `scripts\schedule-db-backup.ps1` (Admin, once) |

---

## Beta testers

1. Add Spotify email in [Developer Dashboard](https://developer.spotify.com/dashboard) → User Management  
2. Send **`docs/BETA-TESTER-GUIDE.md`**  
3. Log sessions in **`docs/beta-feedback-log.csv`**  
4. Keep **`start.bat`** running  

---

## More

- [SELF-HOST-PRODUCTION.md](./SELF-HOST-PRODUCTION.md)  
- [PRODUCTION-CHECKLIST.md](./PRODUCTION-CHECKLIST.md)  
- [local-commands.md](./local-commands.md)  
