# Register Kwalify to start at user logon (self-host mode).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = "Kwalify-SelfHost-Start"
$Launcher = Join-Path $Root "start-kwalify-selfhost.bat"

if (-not (Test-Path $Launcher)) {
  throw "Missing $Launcher"
}

$action = New-ScheduledTaskAction -Execute $Launcher -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Start Kwalify self-hosted server at login" -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName (runs at logon)" -ForegroundColor Green
