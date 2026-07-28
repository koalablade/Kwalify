# Startup maintenance gate + light audits (called by ensure-kwalify-ready.ps1 before API start).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [int]$WeeklyDays = 7
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path $Root).Path
. (Join-Path $PSScriptRoot "startup-audit-lib.ps1") -Root $Root

$reportsDir = Join-Path $Root "reports"
$pendingRoutesPath = Join-Path $reportsDir ".maintenance-pending-routes"
if (-not (Test-Path -LiteralPath $reportsDir)) {
  New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
}

$warnings = @()

function Step([string]$msg) {
  Write-Host ""
  Write-Host ">> $msg" -ForegroundColor Cyan
}

function Note-Warning([string]$msg) {
  $script:warnings += $msg
  Write-Host "  [!] $msg" -ForegroundColor Yellow
}

Step "Startup audits"
Invoke-AuditScript -Label "Beta observability defaults" `
  -ScriptPath (Join-Path $Root "scripts\ensure-beta-observability.ps1") -ExtraArgs @("-Root", $Root)
Invoke-AuditScript -Label "Beta readiness" `
  -ScriptPath (Join-Path $Root "scripts\check-beta-ready.ps1") -ExtraArgs @("-Root", $Root)

$due = Test-MaintenanceDue -RootPath $Root -AfterDays $WeeklyDays
if ($due) {
  $last = Get-MaintenanceLastRun -RootPath $Root
  if ($last) {
    $age = [math]::Round(((Get-Date) - $last).TotalDays, 1)
    Step "Weekly maintenance due (last run $age days ago)"
  } else {
    Step "Weekly maintenance due (never run)"
  }
  $wmExit = Invoke-AuditScript -Label "Weekly maintenance (pre-API)" `
    -ScriptPath (Join-Path $Root "scripts\weekly-maintenance.ps1") `
    -ExtraArgs @("-Root", $Root, "-SkipRoutes")
  if ($wmExit -ne 0) {
    Note-Warning "Weekly maintenance reported issues  - review above. Continuing start."
  }
  Set-Content -LiteralPath $pendingRoutesPath -Value (Get-Date -Format o) -Encoding ASCII
} else {
  $last = Get-MaintenanceLastRun -RootPath $Root
  if ($last) {
    $age = [math]::Round(((Get-Date) - $last).TotalDays, 1)
    Write-Host "  Weekly maintenance OK (last run $age days ago)" -ForegroundColor DarkGray
  }
  $backupExit = Invoke-AuditScript -Label "Backup verification" `
    -ScriptPath (Join-Path $Root "scripts\verify-backup.ps1") -ExtraArgs @("-Root", $Root)
  if ($backupExit -ne 0) { Note-Warning "Backup verification failed  - run npm run backup:db and npm run maintenance:verify-backup" }

  $uptimeExit = Invoke-AuditScript -Label "Uptime checks" `
    -ScriptPath (Join-Path $Root "scripts\check-uptime.ps1") -ExtraArgs @("-Root", $Root)
  if ($uptimeExit -ne 0) { Note-Warning "Uptime checks reported issues  - see docs\UPTIME-MONITORING.md" }

  Invoke-AuditScript -Label "Windows host" `
    -ScriptPath (Join-Path $Root "scripts\check-windows-host.ps1") -ExtraArgs @("-Root", $Root)

  if (Test-Path -LiteralPath $pendingRoutesPath) {
    Remove-Item -LiteralPath $pendingRoutesPath -Force -ErrorAction SilentlyContinue
  }
}

if (Ensure-WeeklyMaintenanceScheduled -RootPath $Root) {
  Write-Host "  Weekly maintenance task: registered (Sundays 10:00)" -ForegroundColor DarkGray
}

if ($warnings.Count -gt 0) {
  Write-Host ""
  Write-Host "  STARTUP AUDIT WARNINGS ($($warnings.Count))" -ForegroundColor Yellow
  foreach ($w in $warnings) {
    Write-Host "    - $w" -ForegroundColor Yellow
  }
  Write-Host "  API will still start  - fix warnings before inviting testers." -ForegroundColor Yellow
  Write-Host ""
}

exit 0
