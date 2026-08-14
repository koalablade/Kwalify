# Remove Kwalify logon auto-start scheduled task.
$ErrorActionPreference = "Stop"
$TaskName = "Kwalify-SelfHost-Start"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "No logon startup task registered ($TaskName)." -ForegroundColor DarkGray
  exit 0
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task: $TaskName (Kwalify will not start at Windows logon)" -ForegroundColor Green
