# One-shot backup restore test (safe: uses kwalify_restore_test, never touches production).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$DbUser = "postgres",
  [string]$TestDb = "kwalify_restore_test",
  [switch]$NoMark
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$backupDir = Join-Path $Root "backups"

function Find-PgBin([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
    "C:\Program Files\PostgreSQL\18\bin\$name.exe",
    "C:\Program Files\PostgreSQL\17\bin\$name.exe",
    "C:\Program Files\PostgreSQL\16\bin\$name.exe"
  )) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  throw "$name not found. Install PostgreSQL client tools."
}

$psql = Find-PgBin "psql"
$pgRestore = Find-PgBin "pg_restore"

$latest = Get-ChildItem -LiteralPath $backupDir -Filter "kwalify-*.dump" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $latest) {
  Write-Host "[test-backup-restore] No backup found. Run: npm run backup:db" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  BACKUP RESTORE TEST" -ForegroundColor Magenta
Write-Host "  Dump: $($latest.Name)" -ForegroundColor DarkGray
Write-Host ""

& $psql -U $DbUser -c "DROP DATABASE IF EXISTS $TestDb;" | Out-Null
& $psql -U $DbUser -c "CREATE DATABASE $TestDb;" | Out-Null
& $pgRestore -U $DbUser -d $TestDb --clean --if-exists --no-owner $latest.FullName
if ($LASTEXITCODE -ne 0) {
  & $psql -U $DbUser -c "DROP DATABASE IF EXISTS $TestDb;" | Out-Null
  Write-Host "[test-backup-restore] pg_restore failed (exit $LASTEXITCODE)" -ForegroundColor Red
  exit 1
}

$countLine = & $psql -U $DbUser -d $TestDb -t -A -c "SELECT COUNT(*) FROM saved_playlists;" 2>$null
$count = if ($countLine) { [int]($countLine.Trim()) } else { -1 }
& $psql -U $DbUser -c "DROP DATABASE $TestDb;" | Out-Null

if ($count -lt 0) {
  Write-Host "[test-backup-restore] Restore OK but could not read saved_playlists count" -ForegroundColor Yellow
  exit 1
}

Write-Host "  [OK]   Restored and verified ($count saved_playlists)" -ForegroundColor Green
if (-not $NoMark) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\mark-backup-restore-verified.ps1") `
    -Root $Root -Note "automated test-restore ($count saved_playlists)"
}
Write-Host ""
exit 0
