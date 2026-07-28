# Shared health / generation guards for self-host scripts (PowerShell 5.1+).
param(
  [string]$ApiBase = "http://127.0.0.1:5000",
  [string]$Root = ""
)

$script:KwalifyApiBase = $ApiBase.TrimEnd("/")
if ($Root) { $script:KwalifyRoot = (Resolve-Path $Root).Path }

function Invoke-KwalifyJson {
  param(
    [string]$Path,
    [int]$TimeoutSec = 5
  )
  try {
    return Invoke-RestMethod "$script:KwalifyApiBase$Path" -TimeoutSec $TimeoutSec
  } catch {
    return $null
  }
}

function Test-KwalifyLive {
  param([int]$TimeoutSec = 4)
  $payload = Invoke-KwalifyJson -Path "/api/livez" -TimeoutSec $TimeoutSec
  if (-not $payload) { return $false }
  return ($payload.status -eq "ok")
}

function Get-KwalifyHealthz {
  param([int]$TimeoutSec = 8)
  return Invoke-KwalifyJson -Path "/api/healthz" -TimeoutSec $TimeoutSec
}

function Test-KwalifyGenerationBusyFromHealthz {
  param($Hz)
  if (-not $Hz -or -not $Hz.generate) { return $false }
  $active = 0
  $queued = 0
  if ($null -ne $Hz.generate.active) { $active = [int]$Hz.generate.active }
  if ($null -ne $Hz.generate.queued) { $queued = [int]$Hz.generate.queued }
  return ($active -gt 0 -or $queued -gt 0)
}

function Test-KwalifyBenchmarkLockActive {
  if (-not $script:KwalifyRoot) { return $false }
  $lockPath = Join-Path $env:TEMP "kwalify-benchmark.lock"
  if (-not (Test-Path -LiteralPath $lockPath)) { return $false }
  try {
    $fd = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    $fd.Close()
    $fd.Dispose()
    return $false
  } catch {
    return $true
  }
}

function Test-KwalifyGenerationBusy {
  $hz = Get-KwalifyHealthz -TimeoutSec 6
  if (Test-KwalifyGenerationBusyFromHealthz $hz) { return $true }
  return (Test-KwalifyBenchmarkLockActive)
}

function Test-KwalifyApiAlive {
  # livez is the liveness gate — never use readyz for restart decisions.
  if (Test-KwalifyLive -TimeoutSec 4) { return $true }
  # Heavy generation can block the event loop briefly on a single self-host box.
  if (Test-KwalifyLive -TimeoutSec 12) { return $true }
  # Last resort: in-memory healthz (no DB).
  $hz = Get-KwalifyHealthz -TimeoutSec 10
  return ($hz -and $hz.status -eq "ok")
}

function Assert-KwalifySafeToRestart {
  param([string]$Reason = "restart")
  if (Test-KwalifyGenerationBusy) {
    Write-Host "  Refusing $Reason - playlist generation or benchmark is active." -ForegroundColor Yellow
    Write-Host '  Wait for generation to finish, or use stop-kwalify.bat if you must interrupt.'
    return $false
  }
  return $true
}
