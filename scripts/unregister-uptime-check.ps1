# Remove the 5-minute local uptime scheduled task (not needed when Kwalify is manual-start only).
$ErrorActionPreference = "Stop"
$TaskName = "Kwalify-Uptime-Check"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "No uptime scheduled task ($TaskName)." -ForegroundColor DarkGray
  exit 0
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task: $TaskName (no background uptime polling)" -ForegroundColor Green
