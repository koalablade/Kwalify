# Stop Kwalify starting at Windows logon; remove background uptime polling.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "  Disable Kwalify auto-start + background uptime checks" -ForegroundColor Magenta
Write-Host ""

& (Join-Path $Root "scripts\unregister-startup-task.ps1")
& (Join-Path $Root "scripts\unregister-uptime-check.ps1")

foreach ($script in @("schedule-db-backup.ps1", "schedule-weekly-maintenance.ps1")) {
  $path = Join-Path $Root "scripts\$script"
  if (-not (Test-Path -LiteralPath $path)) { continue }
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $path
    Write-Host "  Updated: $script" -ForegroundColor Green
  } catch {
    Write-Host "  Could not update $script (try Run as Administrator): $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "  Done. Kwalify starts only when you run start.bat." -ForegroundColor Green
Write-Host "  No 5-minute uptime polling. Use maintain.bat or check-uptime.ps1 when the app is running." -ForegroundColor DarkGray
Write-Host ""
