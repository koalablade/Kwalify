# Full self-host production readiness report (automated checks + manual reminders).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path $Root).Path
$envPath = Join-Path $Root ".env"
$manual = 0

Write-Host ""
Write-Host "  KWALIFY SELF-HOST PRODUCTION READINESS" -ForegroundColor Magenta
Write-Host "  ======================================" -ForegroundColor Magenta
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check-beta-ready.ps1") -Root $Root
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check-uptime.ps1") -Root $Root
$uptimeExit = $LASTEXITCODE
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check-windows-host.ps1") -Root $Root
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\verify-backup.ps1") -Root $Root
$backupExit = $LASTEXITCODE
Write-Host ""

Write-Host "  CAPACITY & MONITORING" -ForegroundColor Cyan
if (Test-Path -LiteralPath $envPath) {
  $workers = (Select-String -Path $envPath -Pattern '^\s*V3_PARALLEL_WORKERS=' | Select-Object -First 1)
  $conc = (Select-String -Path $envPath -Pattern '^\s*GENERATE_CONCURRENCY_LIMIT=' | Select-Object -First 1)
  if ($workers) { Write-Host "  [OK]   $((($workers.Line -replace '^\s*','').Trim()))" -ForegroundColor Green }
  else { Write-Host "  [?]    V3_PARALLEL_WORKERS not set (recommended: 4)" -ForegroundColor Yellow; $manual++ }
  if ($conc) { Write-Host "  [OK]   $((($conc.Line -replace '^\s*','').Trim()))" -ForegroundColor Green }
  else { Write-Host "  [?]    GENERATE_CONCURRENCY_LIMIT not set (recommended: 2)" -ForegroundColor Yellow; $manual++ }
  if (Select-String -Path $envPath -Pattern '^\s*SENTRY_DSN=https?://' -Quiet) {
    Write-Host "  [OK]   SENTRY_DSN configured" -ForegroundColor Green
  } else {
    Write-Host "  [?]    SENTRY_DSN not set (optional - sentry.io free tier)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "  YOUR MANUAL CHECKLIST (cannot be automated)" -ForegroundColor Cyan
Write-Host "  -------------------------------------------"
@(
  "Spotify Extended Quota / app review submitted",
  "Beta testers added in Spotify Dashboard -> User Management",
  "5-10 testers used the app (track in docs/beta-feedback-log.csv)",
  "Phone test completed this week",
  "Secrets backup (.env) stored safely offline"
) | ForEach-Object {
  Write-Host "  [ ] $_" -ForegroundColor DarkGray
  $manual++
}

Write-Host ""
Write-Host "  Full guide: docs\SELF-HOST-PRODUCTION.md"
Write-Host ""

if ($uptimeExit -ne 0 -or $backupExit -ne 0) {
  Write-Host "  Fix automated [!!] items above first." -ForegroundColor Yellow
  exit 1
}
Write-Host "  Automated checks OK - complete manual items for full production." -ForegroundColor Green
exit 0
