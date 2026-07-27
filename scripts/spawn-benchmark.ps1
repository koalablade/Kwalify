# Reliable benchmark spawn - called from launcher UI (avoids broken argument quoting).
param(
  [string]$Request = "",
  [string]$Suite = "",
  [switch]$RepeatLast,
  [switch]$DryRun
)

$Host.UI.RawUI.WindowTitle = "Kwalify Benchmark RUN"
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$logDir = Join-Path $Root "reports"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$log = Join-Path $logDir "benchmark-spawn.log"

function Write-SpawnLog([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}

Write-SpawnLog "START suite=$Suite request=$Request repeat=$RepeatLast dryRun=$DryRun"

try {
  $ps1 = Join-Path $PSScriptRoot "run-kwalify-benchmark.ps1"
  $params = @{
    NoMenu = $true
    SpawnLocal = $true
  }
  if ($DryRun) { $params.DryRun = $true }
  if ($RepeatLast) { $params.RepeatLast = $true }
  elseif ($Suite) { $params.Suite = $Suite }
  elseif ($Request) { $params.Request = $Request }
  else { throw "Nothing to run." }

  & $ps1 @params
  $code = if ($null -eq $LASTEXITCODE) { 0 }
    elseif ($LASTEXITCODE -is [System.Array]) { [int]$LASTEXITCODE[$LASTEXITCODE.Count - 1] }
    else { [int]$LASTEXITCODE }
  Write-SpawnLog "DONE exit=$code"
  exit $code
} catch {
  Write-SpawnLog "ERROR $($_.Exception.Message)"
  Write-Host "BENCHMARK FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "See kwalify-benchmark.log and reports\benchmark-spawn.log" -ForegroundColor Yellow
  Write-Host "If stuck, click Clear stuck lock on the benchmark page or run stop-kwalify-benchmark.bat" -ForegroundColor Yellow
  pause
  exit 1
}
