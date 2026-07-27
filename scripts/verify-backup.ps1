# Verify Kwalify database backups exist and are readable.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [int]$MaxAgeHours = 36
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$backupDir = Join-Path $Root "backups"
$ok = $true

function Find-PgRestore {
  $cmd = Get-Command pg_restore -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
    "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe",
    "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe",
    "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe"
  )) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

Write-Host ""
Write-Host "  BACKUP VERIFICATION" -ForegroundColor Magenta
Write-Host ""

if (-not (Test-Path -LiteralPath $backupDir)) {
  Write-Host "  [!!] No backups folder. Run: npm run backup:db" -ForegroundColor Red
  exit 1
}

$latest = Get-ChildItem -LiteralPath $backupDir -Filter "kwalify-*.dump" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $latest) {
  Write-Host "  [!!] No kwalify-*.dump files in backups\" -ForegroundColor Red
  Write-Host "         Run: npm run backup:db" -ForegroundColor Yellow
  exit 1
}

$ageHours = ((Get-Date) - $latest.LastWriteTime).TotalHours
$sizeMb = [math]::Round($latest.Length / 1MB, 2)
Write-Host "  Latest: $($latest.Name)" -ForegroundColor Green
Write-Host "         $($latest.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))  (${sizeMb} MB)" -ForegroundColor DarkGray

if ($ageHours -gt $MaxAgeHours) {
  Write-Host "  [!!] Backup is $([math]::Round($ageHours, 1))h old (warn if > ${MaxAgeHours}h)" -ForegroundColor Yellow
  $ok = $false
} else {
  Write-Host "  [OK]   Backup age ($([math]::Round($ageHours, 1))h)" -ForegroundColor Green
}

$pgRestore = Find-PgRestore
if (-not $pgRestore) {
  Write-Host "  [?]    pg_restore not found - skipped integrity list" -ForegroundColor Yellow
} else {
  $list = & $pgRestore --list $latest.FullName 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!!] pg_restore --list failed - dump may be corrupt" -ForegroundColor Red
    $list | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray }
    exit 1
  }
  $entries = ($list | Measure-Object -Line).Lines
  Write-Host "  [OK]   Dump readable ($entries archive entries)" -ForegroundColor Green
}

Write-Host ""
if ($ok) {
  Write-Host "  Backups look healthy." -ForegroundColor Green
  exit 0
}
Write-Host "  Run npm run backup:db now, or check scheduled task Kwalify-Daily-DB-Backup." -ForegroundColor Yellow
exit 1
