# Show latest benchmark status (readable in terminal or share STATUS.txt).
param(
  [switch]$OpenFolder,
  [switch]$OpenHtml
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\benchmark-lib.ps1" -Root $root

Write-Host ""
Write-Host "  KWALIFY BENCHMARK STATUS" -ForegroundColor Magenta
Write-Host ""
Show-BenchmarkStatus

$latest = Get-LatestBenchmarkRun
if ($latest -and $latest.runDir) {
  $hk = Find-LatestHumanKeepRun
  if ($hk -and (Test-Path $hk.summaryJson)) {
    Write-Host ""
    Write-Host "LATEST HUMAN-KEEP RUN" -ForegroundColor Cyan
    Write-Host "  $($hk.dir)"
    $raw = Parse-HumanKeepMetrics $hk.summaryJson
    $metrics = @{}
    foreach ($k in $raw.Keys) { $metrics["human_$k"] = $raw[$k] }
    Write-Host (Format-MetricsDashboard -Metrics $metrics)
  }
}

if ($OpenFolder -and $latest -and $latest.runDir) {
  Start-Process explorer.exe $latest.runDir | Out-Null
}

if ($OpenHtml) {
  $html = Join-Path $root "frontend\public\benchmark-status.html"
  if (Test-Path $html) { Start-Process $html | Out-Null }
}

Write-Host ""
Write-Host "Tip: double-click start-kwalify-benchmark.bat (menu option 2 = status, 3 = package)"
Write-Host ""
