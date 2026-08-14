# Register a daily Kwalify PostgreSQL backup at 3:00 AM.
# Run once as Administrator.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = "Kwalify-Daily-DB-Backup"
$Script = Join-Path $Root "scripts\backup-db.ps1"

if (-not (Test-Path $Script)) {
  throw "Missing backup script: $Script"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$Script`""

$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Daily pg_dump backup for Kwalify" -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName (daily 3:00 AM)"
Write-Host "Backups: $Root\backups\"
