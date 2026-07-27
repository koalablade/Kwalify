# Windows host checks for 24/7 self-hosting.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path $Root).Path
$warn = 0

Write-Host ""
Write-Host "  WINDOWS HOST CHECK" -ForegroundColor Magenta

# Sleep on AC
try {
  $sleep = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null | Select-String "Current AC Power Setting Index"
  if ($sleep -match "0x00000000") {
    Write-Host "  [OK]   Sleep disabled on AC power" -ForegroundColor Green
  } else {
    Write-Host "  [!!]   PC may sleep - disable sleep on AC (Settings -> Power)" -ForegroundColor Yellow
    $warn++
  }
} catch {
  Write-Host "  [?]    Could not read power plan" -ForegroundColor Yellow
  $warn++
}

# Disk space on drive hosting project
$drive = (Split-Path $Root -Qualifier)
$disk = Get-PSDrive -Name $drive.TrimEnd(':') -ErrorAction SilentlyContinue
if ($disk) {
  $freeGb = [math]::Round($disk.Free / 1GB, 1)
  if ($freeGb -ge 10) {
    Write-Host "  [OK]   Free disk on ${drive} ${freeGb} GB" -ForegroundColor Green
  } else {
    Write-Host "  [!!]   Low disk on ${drive} ${freeGb} GB (need 10+ GB)" -ForegroundColor Yellow
    $warn++
  }
}

# Backup restore verified marker
$marker = Join-Path $Root "reports\.backup-restore-verified"
if (Test-Path -LiteralPath $marker) {
  $when = Get-Content -LiteralPath $marker -Raw
  Write-Host "  [OK]   Backup restore tested ($when)" -ForegroundColor Green
} else {
  Write-Host "  [!!]   Backup restore not verified yet - see docs\BACKUP-RESTORE.md" -ForegroundColor Yellow
  $warn++
}

# External uptime monitor reminder
$uptimeDoc = Join-Path $Root "reports\.external-uptime-configured"
if (Test-Path -LiteralPath $uptimeDoc) {
  Write-Host "  [OK]   External uptime monitor noted" -ForegroundColor Green
} else {
  Write-Host "  [!!]   Set up UptimeRobot (see docs\UPTIME-MONITORING.md), then run:" -ForegroundColor Yellow
  Write-Host "         scripts\mark-external-uptime.ps1" -ForegroundColor DarkGray
  $warn++
}

Write-Host ""
if ($warn -eq 0) {
  Write-Host "  Host checks passed." -ForegroundColor Green
  exit 0
}
Write-Host "  $warn item(s) need your attention (manual steps)." -ForegroundColor Yellow
exit 0
