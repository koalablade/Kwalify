# External uptime monitoring (15 minutes)

Your PC can go down without you noticing. Use a **free external** monitor.

## UptimeRobot (recommended, free)

1. Sign up at [uptimerobot.com](https://uptimerobot.com)
2. **Add Monitor**
   - Type: **HTTPS**
   - URL: `https://kwalify.net/api/healthz`
   - Interval: **5 minutes**
3. **Alert contacts** — your email (and optional SMS)
4. Save

Optional second monitor: `https://kwalify.net/api/readyz` (stricter — includes DB)

## After setup

From the Kwalify project folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mark-external-uptime.ps1
```

This marks the check green in `production-ready.bat` and `maintain.bat`.

## What to do when alerted

1. On your PC: `start.bat` (if not running)
2. Still down: `stop-kwalify.bat` then `start.bat`
3. Read `kwalify-watchdog.log` and `kwalify-api.log`
4. Tunnel issues: `repair-tunnel.bat`

Local checks also log to `reports\uptime-check.log` (from `maintain.bat`).
