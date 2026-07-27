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

. (Join-Path $Root "scripts\load-dotenv.ps1") -Root $Root

$localApi = "http://127.0.0.1:5000"
$localBenchmark = "$localApi/benchmark"

function Test-MainApiUp {
  try {
    $r = Invoke-WebRequest -Uri "$localApi/api/readyz" -UseBasicParsing -TimeoutSec 4
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

if (-not (Test-MainApiUp)) {
  throw "Kwalify server is not running. Double-click start.bat first, then open: $localBenchmark"
}

$redirectScript = Join-Path $Root "scripts\ensure-benchmark-redirect.ps1"
if (Test-Path -LiteralPath $redirectScript) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $redirectScript -Root $Root | Out-Null
}

Write-Info "Benchmark URL: $localBenchmark"
if ($OpenBrowser) {
  Start-Process $localBenchmark | Out-Null
}
