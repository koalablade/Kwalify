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

function Step([string]$msg) {
  Write-Host ""
  Write-Host ">> $msg" -ForegroundColor Cyan
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
  Invoke-AuditScript -Label "Weekly maintenance (pre-API)" `
    -ScriptPath (Join-Path $Root "scripts\weekly-maintenance.ps1") `
    -ExtraArgs @("-Root", $Root, "-SkipRoutes")
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  Weekly maintenance reported issues — review above. Continuing start." -ForegroundColor Yellow
  }
  Set-Content -LiteralPath $pendingRoutesPath -Value (Get-Date -Format o) -Encoding ASCII
} else {
  $last = Get-MaintenanceLastRun -RootPath $Root
  if ($last) {
    $age = [math]::Round(((Get-Date) - $last).TotalDays, 1)
    Write-Host "  Weekly maintenance OK (last run $age days ago)" -ForegroundColor DarkGray
  }
  Invoke-AuditScript -Label "Backup verification" `
    -ScriptPath (Join-Path $Root "scripts\verify-backup.ps1") -ExtraArgs @("-Root", $Root)
  Invoke-AuditScript -Label "Uptime checks" `
    -ScriptPath (Join-Path $Root "scripts\check-uptime.ps1") -ExtraArgs @("-Root", $Root)
  Invoke-AuditScript -Label "Windows host" `
    -ScriptPath (Join-Path $Root "scripts\check-windows-host.ps1") -ExtraArgs @("-Root", $Root)
  if (Test-Path -LiteralPath $pendingRoutesPath) {
    Remove-Item -LiteralPath $pendingRoutesPath -Force -ErrorAction SilentlyContinue
  }
}

if (Ensure-WeeklyMaintenanceScheduled -RootPath $Root) {
  Write-Host "  Weekly maintenance task: registered (Sundays 10:00)" -ForegroundColor DarkGray
}

exit 0
