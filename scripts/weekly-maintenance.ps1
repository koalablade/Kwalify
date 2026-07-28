# Weekly upkeep for local self-hosted Kwalify (readiness, backups, routes).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [switch]$SkipRoutes,
  [switch]$MarkComplete
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path $Root).Path
$reportPath = Join-Path $Root "reports\maintenance-last-run.txt"
$reportsDir = Join-Path $Root "reports"
if (-not (Test-Path -LiteralPath $reportsDir)) {
  New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
}

$routesRan = $false
$routesExit = 0

$lines = @("Kwalify weekly maintenance  - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "")

function Note([string]$text) {
  Write-Host $text
  $script:lines += $text
}

Note ""
Note "  KWALIFY WEEKLY MAINTENANCE"
Note ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check-beta-ready.ps1") -Root $Root
Note ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\verify-backup.ps1") -Root $Root
$backupExit = $LASTEXITCODE
Note ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check-uptime.ps1") -Root $Root
$uptimeExit = $LASTEXITCODE
Note ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check-windows-host.ps1") -Root $Root
Note ""

$apiUp = $false
try {
  $rz = Invoke-RestMethod "http://127.0.0.1:5000/api/readyz" -TimeoutSec 3
  $apiUp = ($rz.status -eq "ready" -or $rz.readiness -eq "ready")
} catch {}

if ($apiUp -and -not $SkipRoutes) {
  Note "  Running route smoke..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\test-website-routes.ps1")
  $routesExit = $LASTEXITCODE
  $routesRan = $true
  Note ""
} elseif (-not $SkipRoutes) {
  Note "  Skipping route smoke (API not running  - start Kwalify first)."
  Note "  Maintenance will NOT be marked complete until routes pass."
  Note ""
} elseif ($SkipRoutes) {
  Note "  Route smoke deferred until API is up (startup will run routes after launch)."
  Note ""
}

foreach ($logName in @("kwalify-api.log", "kwalify-start.log", "kwalify-benchmark.log")) {
  $logPath = Join-Path $Root $logName
  if (Test-Path -LiteralPath $logPath) {
    $mb = [math]::Round((Get-Item $logPath).Length / 1MB, 2)
    if ($mb -gt 8) {
      Note "  [?] $logName is ${mb} MB  - launcher rotates at 10 MB; safe to delete .old copies"
    }
  }
}

Note ""
Note "  Tips:"
Note "    - Add beta testers in Spotify Dashboard -> User Management"
Note "    - Keep start.bat running while friends test"
Note "    - Docs: docs\LOCAL-MAINTENANCE.md"
Note ""

Set-Content -LiteralPath $reportPath -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host "  Report saved: reports\maintenance-last-run.txt" -ForegroundColor DarkGray

$canMarkComplete = $false
if ($MarkComplete) {
  $canMarkComplete = $true
} elseif (-not $SkipRoutes -and $routesRan -and $routesExit -eq 0) {
  $canMarkComplete = $true
}

if ($canMarkComplete) {
  . (Join-Path $Root "scripts\startup-audit-lib.ps1") -Root $Root
  Set-MaintenanceLastRun -RootPath $Root
  Write-Host "  Maintenance marked complete: reports\.maintenance-last-run" -ForegroundColor DarkGray
} elseif (-not $SkipRoutes -and -not $routesRan) {
  Write-Host "  Maintenance NOT marked complete  - start Kwalify, then run maintain.bat again." -ForegroundColor Yellow
} elseif (-not $SkipRoutes -and $routesRan -and $routesExit -ne 0) {
  Write-Host "  Maintenance NOT marked complete  - fix route smoke failures above." -ForegroundColor Yellow
}
Write-Host ""

if ($backupExit -ne 0 -or $uptimeExit -ne 0) {
  exit 1
}
exit 0
