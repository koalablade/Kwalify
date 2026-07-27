# Backup and restore (Windows self-host)

## Automatic backups

- **Daily 3:00 AM** — scheduled task `Kwalify-Daily-DB-Backup`
- **Manual:** `npm run backup:db`
- **Files:** `backups\kwalify-YYYYMMDD-HHMMSS.dump`

Verify anytime: `npm run maintenance:verify-backup`

---

## One-time restore test (required for production)

**Automated (recommended):**

```powershell
npm run maintenance:test-restore
```

On success this auto-marks verified. Use `-NoMark` for a dry run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\test-backup-restore.ps1 -NoMark
```

**Manual** — use a **test database** so you never overwrite production data.

### 1. Create test database

Open PowerShell (as a user that can run `psql`):

```powershell
psql -U postgres -c "CREATE DATABASE kwalify_restore_test;"
```

### 2. Find latest backup

```powershell
dir backups\kwalify-*.dump | Sort-Object LastWriteTime -Descending | Select-Object -First 1
```

### 3. Restore into test DB

Replace the filename and adjust PostgreSQL path if needed:

```powershell
$dump = "backups\kwalify-YYYYMMDD-HHMMSS.dump"
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -U postgres -d kwalify_restore_test --clean --if-exists $dump
```

### 4. Spot-check

```powershell
psql -U postgres -d kwalify_restore_test -c "SELECT COUNT(*) FROM saved_playlists;"
```

### 5. Drop test DB

```powershell
psql -U postgres -c "DROP DATABASE kwalify_restore_test;"
```

### 6. Mark verified (so checks go green)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mark-backup-restore-verified.ps1
```

---

## Disaster recovery (real restore)

**Only if production DB is lost or corrupted.**

1. Stop Kwalify: `stop-kwalify.bat`
2. Restore dump into `kwalify` database (same `pg_restore` command, `-d kwalify`)
3. Start Kwalify: `start.bat`

Keep a copy of `.env` offline — without it you cannot reconnect Spotify sessions cleanly.
