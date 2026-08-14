# Register Kwalify to start at user logon (self-host mode). Opt-in only — never called automatically.
# To remove: scripts\unregister-startup-task.ps1
param(
  [switch]$Confirm
)

$ErrorActionPreference = "Stop"
if (-not $Confirm) {
  Write-Host "Skipped: pass -Confirm to register logon startup task." -ForegroundColor Yellow
  exit 0
}
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = "Kwalify-SelfHost-Start"
$Launcher = Join-Path $Root "start.bat"
if (-not (Test-Path $Launcher)) {
  $Launcher = Join-Path $Root "start-kwalify-selfhost.bat"
}

$action = New-ScheduledTaskAction -Execute $Launcher -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Start Kwalify self-hosted server at login" -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName (runs at logon)" -ForegroundColor Green
