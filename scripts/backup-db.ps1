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

function Find-PgDump {
  $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe",
    "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe",
    "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

function Load-DotEnv([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  foreach ($line in Get-Content -LiteralPath $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    if ($t -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $key = $Matches[1]
    if ([Environment]::GetEnvironmentVariable($key)) { continue }
    $v = $Matches[2].Trim().Trim('"').Trim("'")
    Set-Item -Path "env:$key" -Value $v
  }
}

$pgDump = Find-PgDump
if (-not $pgDump) {
  Fail "pg_dump not found (install PostgreSQL client tools)."
}
if (-not $env:DATABASE_URL) {
  $root = Split-Path -Parent $PSScriptRoot
  Load-DotEnv (Join-Path $root ".env")
}
if (-not $env:DATABASE_URL) { Fail "DATABASE_URL is not set." }

$backupDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { "./backups" }
$retain = if ($env:BACKUP_RETAIN) { [int]$env:BACKUP_RETAIN } else { 14 }
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $backupDir "kwalify-$timestamp.dump"

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Write-Host "[backup-db] dumping to $outFile ..."
& $pgDump --format=custom --no-owner --file=$outFile $env:DATABASE_URL
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
