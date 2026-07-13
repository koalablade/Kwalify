# Timestamped PostgreSQL backup for Kwalify (Windows / dev).
#
# Usage:
#   $env:DATABASE_URL = "postgresql://user:pass@host:5432/kwalify"
#   powershell -ExecutionPolicy Bypass -File scripts/backup-db.ps1
#
# Env:
#   DATABASE_URL   (required) connection string
#   BACKUP_DIR     (optional) output dir, default ./backups
#   BACKUP_RETAIN  (optional) keep the most recent N dumps, default 14 (0 = keep all)
#
# Produces: <BACKUP_DIR>/kwalify-YYYYMMDD-HHMMSS.dump (pg_dump custom format).
# Exits non-zero on any failure.

$ErrorActionPreference = "Stop"

function Fail([string]$msg) {
  Write-Error "[backup-db] ERROR: $msg"
  exit 1
}

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  Fail "pg_dump not found on PATH (install the PostgreSQL client tools)."
}
if (-not $env:DATABASE_URL) { Fail "DATABASE_URL is not set." }

$backupDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { "./backups" }
$retain = if ($env:BACKUP_RETAIN) { [int]$env:BACKUP_RETAIN } else { 14 }
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $backupDir "kwalify-$timestamp.dump"

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Write-Host "[backup-db] dumping to $outFile ..."
& pg_dump --format=custom --no-owner --file=$outFile $env:DATABASE_URL
if ($LASTEXITCODE -ne 0) {
  Remove-Item -Force $outFile -ErrorAction SilentlyContinue
  Fail "pg_dump failed (exit $LASTEXITCODE); partial file removed."
}
if (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -eq 0) {
  Remove-Item -Force $outFile -ErrorAction SilentlyContinue
  Fail "backup file is empty; removed."
}

$sizeKb = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
Write-Host "[backup-db] OK: $outFile ($sizeKb KB)"

if ($retain -gt 0) {
  Get-ChildItem -Path $backupDir -Filter "kwalify-*.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $retain |
    ForEach-Object {
      Write-Host "[backup-db] pruning old backup: $($_.FullName)"
      Remove-Item -Force $_.FullName
    }
}

Write-Host "[backup-db] Restore this backup with (stop the app first):"
Write-Host "  pg_restore --clean --if-exists --no-owner --dbname `"$env:DATABASE_URL`" `"$outFile`""
