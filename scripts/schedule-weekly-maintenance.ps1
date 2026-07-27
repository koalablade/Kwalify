# Register weekly maintenance (Sunday 10:00 AM). Run once as Administrator.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = "Kwalify-Weekly-Maintenance"
$Script = Join-Path $Root "scripts\weekly-maintenance.ps1"

if (-not (Test-Path $Script)) {
  throw "Missing script: $Script"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Script`" -Root `"$Root`""

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 10:00AM

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Description "Weekly Kwalify readiness + backup verification" -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName (Sundays 10:00 AM)"
Write-Host "Runs: scripts\weekly-maintenance.ps1"
