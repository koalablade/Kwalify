# Register local uptime checks every 5 minutes (logs to reports/uptime-check.log).
# Complements external UptimeRobot - runs while this PC is on.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = "Kwalify-Uptime-Check"
$Script = Join-Path $Root "scripts\check-uptime.ps1"

if (-not (Test-Path $Script)) {
  throw "Missing script: $Script"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Script`" -Root `"$Root`""

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Description "Every 5 min health check for Kwalify (local + public)" -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName (every 5 minutes)"
Write-Host "Log: $Root\reports\uptime-check.log"
Write-Host "Still add UptimeRobot for alerts when this PC is off - see docs\UPTIME-MONITORING.md"
