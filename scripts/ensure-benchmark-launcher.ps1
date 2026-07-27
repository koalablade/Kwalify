# Open benchmark on this PC (local control panel — runs always happen here).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [switch]$OpenBrowser,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
Set-Location $Root

function Write-Info([string]$msg) {
  if (-not $Quiet) { Write-Host "  $msg" }
}

$dotenv = Join-Path $Root "scripts\load-dotenv.ps1"
if (Test-Path -LiteralPath (Join-Path $Root ".env")) {
  . $dotenv -Root $Root
}

$localApi = "http://127.0.0.1:5000"

function Test-MainApiUp {
  try {
    $r = Invoke-WebRequest -Uri "$localApi/api/readyz" -UseBasicParsing -TimeoutSec 4
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Get-BenchmarkWebUrl {
  foreach ($candidate in @(
    @{ Base = "https://kwalify.net"; Url = "https://kwalify.net/benchmark" },
    @{ Base = $localApi; Url = "$localApi/benchmark" }
  )) {
    try {
      $ping = Invoke-RestMethod -Uri "$($candidate.Base)/api/benchmark/ping" -TimeoutSec 4
      if ($ping.ok) { return $candidate.Url }
    } catch {}
  }
  return "$localApi/benchmark"
}

if (-not (Test-MainApiUp)) {
  Write-Host ""
  Write-Host "  Kwalify server is not running." -ForegroundColor Red
  Write-Host "  1. Double-click start.bat and wait for it to finish"
  Write-Host "  2. Then run this again"
  Write-Host ""
  exit 1
}

$redirectScript = Join-Path $Root "scripts\ensure-benchmark-redirect.ps1"
if (Test-Path -LiteralPath $redirectScript) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $redirectScript -Root $Root | Out-Null
}

$benchmarkUrl = Get-BenchmarkWebUrl
Write-Info "Benchmark URL: $benchmarkUrl"
if ($OpenBrowser) {
  Start-Process $benchmarkUrl | Out-Null
}
