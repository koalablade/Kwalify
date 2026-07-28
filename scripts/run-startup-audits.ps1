# Startup test + post-start audits (called from start-kwalify-core.ps1).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [ValidateSet("tests", "post")]
  [string]$Phase = "tests",
  [switch]$Quick,
  [ValidateSet("local", "domain", "selfhost", "")]
  [string]$Mode = "",
  [string]$LiveUrl = ""
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path $Root).Path
Set-Location $Root

. (Join-Path $PSScriptRoot "startup-audit-lib.ps1") -Root $Root

$reports = Join-Path $Root "reports"
if (-not (Test-Path -LiteralPath $reports)) {
  New-Item -ItemType Directory -Force -Path $reports | Out-Null
}

function Invoke-NpmTest {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ScriptName
  )

  Write-Host ""
  Write-Host "  >> $Label" -ForegroundColor Cyan
  $prevErr = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $output = & npm run $ScriptName 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $prevErr
  if ($exitCode -ne 0) {
    Write-Host "  $Label failed" -ForegroundColor Red
    $output | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }
  } else {
    Write-Host "  $Label passed" -ForegroundColor Green
  }
  return $exitCode
}

switch ($Phase) {
  "tests" {
    if ($Quick) {
      Write-Host "  Startup tests skipped (-Quick)" -ForegroundColor DarkGray
      exit 0
    }
    if (-not (Test-Path (Join-Path $Root "backend\dist\server.js"))) {
      Write-Host "  Startup tests skipped (no build yet)" -ForegroundColor DarkGray
      exit 0
    }

    Write-Host ""
    Write-Host "  STARTUP AUDITS (tests)" -ForegroundColor Magenta
    $smokeExit = Invoke-NpmTest -Label "Smoke tests" -ScriptName "test:smoke"
    if ($smokeExit -ne 0) { exit $smokeExit }

    $obsExit = Invoke-NpmTest -Label "Observability completeness" -ScriptName "test:observability-completeness"
    if ($obsExit -ne 0) { exit $obsExit }

    Write-Host ""
    exit 0
  }

  "post" {
    Write-Host ""
    Write-Host "  STARTUP AUDITS (post-start)" -ForegroundColor Magenta

    $pendingRoutes = Join-Path $reports ".maintenance-pending-routes"
    Invoke-AuditScript -Label "Website routes" `
      -ScriptPath (Join-Path $Root "scripts\test-website-routes.ps1")

    $live = $LiveUrl
    if (-not $live) {
      $envPath = Join-Path $Root ".env"
      if (Test-Path -LiteralPath $envPath) {
        foreach ($line in Get-Content -LiteralPath $envPath) {
          $t = $line.Trim()
          if (-not $t -or $t.StartsWith("#")) { continue }
          if ($t -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $v = $Matches[2].Trim().Trim('"').Trim("'")
            if (-not [string]::IsNullOrWhiteSpace($v)) {
              Set-Item -Path "env:$($Matches[1])" -Value $v
            }
          }
        }
      }
      if ($env:KWALIFY_LIVE_URL) { $live = $env:KWALIFY_LIVE_URL }
      elseif ($env:APP_URL -like "https://*") { $live = $env:APP_URL }
    }
    $live = $live.TrimEnd("/")

    if ($live -like "https://*") {
      $env:KWALIFY_LIVE_URL = $live
      Invoke-NpmTest -Label "Production health smoke" -ScriptName "test:production-health" | Out-Null
    } else {
      Write-Host "  Production health smoke skipped (no HTTPS live URL)" -ForegroundColor DarkGray
    }

    if ($Mode -eq "selfhost" -or -not $Mode) {
      Invoke-AuditScript -Label "Production readiness report" `
        -ScriptPath (Join-Path $Root "scripts\check-production-ready.ps1") `
        -ExtraArgs @("-Root", $Root)
    }

    if (Test-Path -LiteralPath $pendingRoutes) {
      Write-Host ""
      Write-Host "  Completing weekly maintenance (marking done)..." -ForegroundColor Yellow
      & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\weekly-maintenance.ps1") `
        -Root $Root -SkipRoutes -MarkComplete | Out-Null
      Remove-Item -LiteralPath $pendingRoutes -Force -ErrorAction SilentlyContinue
    }

    Write-Host ""
    Write-Host "  Startup audits complete" -ForegroundColor Green
    Write-Host ""
    exit 0
  }
}
