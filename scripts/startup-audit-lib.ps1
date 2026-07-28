# Shared helpers for startup audits and weekly maintenance gating.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$Root = (Resolve-Path $Root).Path

$script:MaintenanceMarkerPath = Join-Path $Root "reports\.maintenance-last-run"
$script:MaintenanceReportPath = Join-Path $Root "reports\maintenance-last-run.txt"
$script:MaintenanceDueDays = 7

function Get-MaintenanceLastRun {
  param([string]$RootPath = $Root)

  $marker = Join-Path $RootPath "reports\.maintenance-last-run"
  if (Test-Path -LiteralPath $marker) {
    $raw = (Get-Content -LiteralPath $marker -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($raw) {
      try { return [datetime]::Parse($raw.Trim()) } catch {}
    }
  }

  $report = Join-Path $RootPath "reports\maintenance-last-run.txt"
  if (Test-Path -LiteralPath $report) {
    $first = (Get-Content -LiteralPath $report -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($first -match '(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})') {
      try { return [datetime]::Parse($Matches[1]) } catch {}
    }
  }

  return $null
}

function Test-MaintenanceDue {
  param(
    [string]$RootPath = $Root,
    [int]$AfterDays = $script:MaintenanceDueDays
  )

  $last = Get-MaintenanceLastRun -RootPath $RootPath
  if (-not $last) { return $true }
  return ((Get-Date) - $last).TotalDays -ge $AfterDays
}

function Set-MaintenanceLastRun {
  param(
    [string]$RootPath = $Root,
    [datetime]$When = (Get-Date)
  )

  $reports = Join-Path $RootPath "reports"
  if (-not (Test-Path -LiteralPath $reports)) {
    New-Item -ItemType Directory -Force -Path $reports | Out-Null
  }
  Set-Content -LiteralPath (Join-Path $reports ".maintenance-last-run") -Value $When.ToString("o") -Encoding ASCII
}

function Ensure-WeeklyMaintenanceScheduled {
  param([string]$RootPath = $Root)

  $taskName = "Kwalify-Weekly-Maintenance"
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) { return $true }

  $scheduleScript = Join-Path $RootPath "scripts\schedule-weekly-maintenance.ps1"
  if (-not (Test-Path -LiteralPath $scheduleScript)) { return $false }

  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $scheduleScript
    return $true
  } catch {
    return $false
  }
}

function Invoke-AuditScript {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [string[]]$ExtraArgs = @(),
    [switch]$Blocking
  )

  if (-not (Test-Path -LiteralPath $ScriptPath)) {
    Write-Host "  [skip] $Label - script missing" -ForegroundColor DarkGray
    return 0
  }

  Write-Host ""
  Write-Host "  >> $Label" -ForegroundColor Cyan
  $prevErr = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @ExtraArgs
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $prevErr

  if ($exitCode -ne 0) {
    if ($Blocking) {
      Write-Host "  $Label failed (exit $exitCode)" -ForegroundColor Red
    } else {
      Write-Host "  $Label finished with warnings (exit $exitCode)" -ForegroundColor Yellow
    }
  }
  return $exitCode
}
