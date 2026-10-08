# Local maintenance — Kwalify self-host (Windows)

## The files you need

| File | When |
|------|------|
| **`KWALIFY-START.bat`** | To run Kwalify — server window, plus the Cloudflare tunnel on a self-host PC |
| **`KWALIFY-STOP.bat`** | When done — stops the server (and the tunnel START started) |
| **`maintain.bat`** | Once a week — readiness, backups, routes |

Read **`START-HERE.txt`** at the project root.

---

## Daily

**`KWALIFY-START.bat`**. It checks Node, `.env` and PostgreSQL, rebuilds only if the
code changed (a failed build stops the start), starts the server in a visible window,
waits for `/api/readyz`, then starts the tunnel when this PC is set up for self-hosting.
It does not run audits, pull from git, register tasks or start a watchdog — nothing
restarts Kwalify behind your back. Run the checks yourself with `maintain.bat`.

---

## When something breaks

| Symptom | Fix |
|---------|-----|
| Site down for friends | `KWALIFY-STOP.bat` then `KWALIFY-START.bat` |
| Start fails | Read the "Kwalify server" window — each failed check says what to do |
| Tunnel not connecting | Look at the minimised `cloudflared` window; `fix-cloudflare-dns.bat` |
| kwalify.net only fails on this PC | `remove-local-hosts.bat` (Run as administrator) |

---

## Weekly

**`maintain.bat`** (or `npm run maintenance:weekly`). **Start Kwalify first** so route smoke runs and the maintenance marker is updated. Nothing schedules this for you.

Last-run marker: `reports\.maintenance-last-run` (also `reports\maintenance-last-run.txt` after `maintain.bat`).

---

## Backups

| Task | Command |
|------|---------|
| Manual backup | `npm run backup:db` |
| Verify latest | `npm run maintenance:verify-backup` |
| Optional nightly task (opt-in) | `scripts\schedule-db-backup.ps1` (Admin, once; remove with `TURN-OFF-AUTOSTART.bat`) |

---

## Beta testers

1. Add Spotify email in [Developer Dashboard](https://developer.spotify.com/dashboard) → User Management  
2. Send **`docs/BETA-TESTER-GUIDE.md`**  
3. Note issues in chat/DM with testers (or your own notes)  
4. Keep **`KWALIFY-START.bat`** running  

---

## More

- [SELF-HOST-PRODUCTION.md](./SELF-HOST-PRODUCTION.md)  
- [PRODUCTION-CHECKLIST.md](./PRODUCTION-CHECKLIST.md)  
- [local-commands.md](./local-commands.md)  
