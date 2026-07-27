# Auto-repair for local self-host: API crashes + Cloudflare tunnel drops.
# Liveness uses /api/livez only — never restart on readyz degradation.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [int]$IntervalSeconds = 300,
  [switch]$Once
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path $Root).Path
$logPath = Join-Path $Root "kwalify-watchdog.log"
$pidFile = Join-Path $Root "reports\.kwalify-watchdog.pid"
$cooldownFile = Join-Path $Root "reports\.api-restart-cooldown"
$graceFile = Join-Path $Root "reports\.api-restart-grace"
$failuresFile = Join-Path $Root "reports\.watchdog-alive-failures"
$tunnelScript = Join-Path $Root "scripts\run-cloudflare-tunnel.ps1"
$apiRestartScript = Join-Path $Root "scripts\restart-api-selfhost.ps1"
$healthLib = Join-Path $Root "scripts\kwalify-health-lib.ps1"
$reportsDir = Join-Path $Root "reports"

. $healthLib -Root $Root

try { $Host.UI.RawUI.WindowTitle = "Kwalify Health Watch" } catch {}

if (-not (Test-Path -LiteralPath $reportsDir)) {
  New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
}
Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Get-AppUrl {
  $envPath = Join-Path $Root ".env"
  if (-not (Test-Path -LiteralPath $envPath)) { return $null }
  $line = Select-String -Path $envPath -Pattern '^\s*APP_URL=' | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line.Line -replace '^\s*APP_URL=', '').Trim().TrimEnd('/')
}

function Get-PersistedAliveFailures {
  if (-not (Test-Path -LiteralPath $failuresFile)) { return 0 }
  try {
    $raw = (Get-Content -LiteralPath $failuresFile -Raw).Trim()
    $n = [int]$raw
    if ($n -lt 0) { return 0 }
    return $n
  } catch { return 0 }
}

function Set-PersistedAliveFailures([int]$count) {
  if ($count -le 0) {
    if (Test-Path -LiteralPath $failuresFile) { Remove-Item -LiteralPath $failuresFile -Force -ErrorAction SilentlyContinue }
    return
  }
  Set-Content -LiteralPath $failuresFile -Value $count -Encoding ASCII
}

function Test-InRestartGrace {
  if (-not (Test-Path -LiteralPath $graceFile)) { return $false }
  try {
    $started = [datetime]::Parse((Get-Content -LiteralPath $graceFile -Raw).Trim())
    return ((Get-Date) - $started).TotalMinutes -lt 5
  } catch { return $false }
}

function Set-RestartGrace {
  Set-Content -LiteralPath $graceFile -Value ((Get-Date).ToString("o")) -Encoding ASCII
}

function Test-ApiReady {
  try {
    $rz = Invoke-RestMethod "$script:KwalifyApiBase/api/readyz" -TimeoutSec 12
    return ($rz.status -eq "ready" -or $rz.readiness -eq "ready")
  } catch { return $false }
}

function Test-PublicReady([string]$url) {
  if (-not $url) { return $false }
  try {
    $pub = Invoke-RestMethod "$url/api/readyz" -TimeoutSec 8
    return ($pub.status -eq "ready" -or $pub.readiness -eq "ready")
  } catch { return $false }
}

function Test-TunnelRunning {
  $tunnelPidFile = Join-Path $Root "reports\.cloudflared.pid"
  if (Test-Path -LiteralPath $tunnelPidFile) {
    $pidVal = (Get-Content $tunnelPidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($pidVal -and (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)) { return $true }
  }
  return [bool](Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Test-ApiRestartAllowed {
  if (Test-InRestartGrace) { return $false }
  if (-not (Test-Path -LiteralPath $cooldownFile)) { return $true }
  try {
    $last = [datetime]::Parse((Get-Content -LiteralPath $cooldownFile -Raw).Trim())
    return ((Get-Date) - $last).TotalMinutes -ge 15
  } catch { return $true }
}

function Set-ApiRestartCooldown {
  Set-Content -LiteralPath $cooldownFile -Value ((Get-Date).ToString("o")) -Encoding ASCII
  Set-RestartGrace
}

function Restart-Tunnel {
  if (-not (Test-Path -LiteralPath $tunnelScript)) { return $false }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $tunnelScript -Root $Root
  Start-Sleep -Seconds 5
  return $true
}

function Restart-Api {
  if (-not (Test-Path -LiteralPath $apiRestartScript)) { return $false }
  if (-not (Assert-KwalifySafeToRestart -Reason "watchdog API restart")) {
    Write-Log "API restart skipped — generation or benchmark active"
    return $false
  }
  Write-Log "Restarting API (restart-api-selfhost.ps1)..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File $apiRestartScript -Root $Root
  Set-ApiRestartCooldown
  Set-PersistedAliveFailures 0
  Start-Sleep -Seconds 3
  return (Test-KwalifyApiAlive)
}

function Rotate-WatchdogLog {
  if (Test-Path -LiteralPath $logPath) {
    $mb = (Get-Item $logPath).Length / 1MB
    if ($mb -gt 2) {
      $old = "$logPath.old"
      if (Test-Path $old) { Remove-Item $old -Force }
      Move-Item $logPath $old -Force
    }
  }
}

Rotate-WatchdogLog
Write-Log "health watch started (PID $PID, interval=${IntervalSeconds}s, liveness=/api/livez)"

$consecutiveAliveFailures = Get-PersistedAliveFailures
$failuresBeforeRestart = 5

try {
  do {
    $appUrl = Get-AppUrl
    $apiAlive = Test-KwalifyApiAlive
    $generationBusy = Test-KwalifyGenerationBusy
    $apiReady = if ($apiAlive) { Test-ApiReady } else { $false }
    $tunnelUp = Test-TunnelRunning
    $publicUp = if ($apiAlive) { Test-PublicReady $appUrl } else { $false }
    $inGrace = Test-InRestartGrace

    if ($apiAlive) {
      if ($consecutiveAliveFailures -gt 0) {
        Write-Log "OK - API alive again (cleared $consecutiveAliveFailures persisted failure(s))"
      }
      $consecutiveAliveFailures = 0
      Set-PersistedAliveFailures 0

      if (-not $apiReady) {
        if ($generationBusy) {
          Write-Log "OK - API alive (generation busy; readyz degraded — not restarting)"
        } else {
          Write-Log "OK - API alive but readyz degraded (monitoring only; never restart on readyz)"
        }
      } elseif ($apiReady -and $tunnelUp -and $publicUp) {
        Write-Log "OK - API, tunnel, and public site healthy"
      } elseif ($apiReady -and -not $tunnelUp) {
        Write-Log "API ready but tunnel down - restarting tunnel..."
        Restart-Tunnel | Out-Null
        if (Test-PublicReady $appUrl) { Write-Log "Tunnel OK; public site up" }
        else { Write-Log "Tunnel restarted; public site still not ready" }
      } elseif ($apiReady -and $tunnelUp -and -not $publicUp) {
        Write-Log "Public site down - restarting tunnel..."
        Restart-Tunnel | Out-Null
      }
    } else {
      $consecutiveAliveFailures++
      Set-PersistedAliveFailures $consecutiveAliveFailures

      if ($inGrace) {
        Write-Log "API livez failed during post-restart grace ($consecutiveAliveFailures/$failuresBeforeRestart) — not restarting yet"
      } elseif ($generationBusy) {
        Write-Log "API livez failed while generation/benchmark active ($consecutiveAliveFailures/$failuresBeforeRestart) — deferring restart"
      } else {
        Write-Log "API not responding to livez ($consecutiveAliveFailures/$failuresBeforeRestart)"
      }

      if ($consecutiveAliveFailures -ge $failuresBeforeRestart) {
        if ($inGrace) {
          Write-Log "Restart deferred — post-restart grace period (5 min)"
        } elseif (Test-KwalifyGenerationBusy) {
          Write-Log "API still not responding but generation active — deferring restart"
        } elseif (Test-ApiRestartAllowed) {
          if (Restart-Api) {
            Write-Log "API restarted successfully"
            $consecutiveAliveFailures = 0
            Set-PersistedAliveFailures 0
            $apiAlive = $true
            $apiReady = Test-ApiReady
            $tunnelUp = Test-TunnelRunning
            $publicUp = if ($apiAlive) { Test-PublicReady $appUrl } else { $false }
            if ($apiAlive -and $tunnelUp -and $publicUp) {
              Write-Log "OK - API, tunnel, and public site healthy after restart"
            }
          } else {
            Write-Log "API restart attempted but still not alive"
          }
        } else {
          Write-Log "API down - restart cooldown or grace (max 1 restart per 15 min)"
        }
      }
    }

    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSeconds
  } while ($true)
} finally {
  Write-Log "health watch stopped"
  if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
}
