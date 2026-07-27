# Auto-repair for local self-host: API crashes + Cloudflare tunnel drops.
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
$tunnelScript = Join-Path $Root "scripts\run-cloudflare-tunnel.ps1"
$apiRestartScript = Join-Path $Root "scripts\restart-api-selfhost.ps1"
$reportsDir = Join-Path $Root "reports"

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

function Test-ApiReady {
  try {
    $rz = Invoke-RestMethod "http://127.0.0.1:5000/api/readyz" -TimeoutSec 4
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
  if (-not (Test-Path -LiteralPath $cooldownFile)) { return $true }
  try {
    $last = [datetime]::Parse((Get-Content -LiteralPath $cooldownFile -Raw).Trim())
    return ((Get-Date) - $last).TotalMinutes -ge 10
  } catch { return $true }
}

function Set-ApiRestartCooldown {
  Set-Content -LiteralPath $cooldownFile -Value ((Get-Date).ToString("o")) -Encoding ASCII
}

function Restart-Tunnel {
  if (-not (Test-Path -LiteralPath $tunnelScript)) { return $false }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $tunnelScript -Root $Root
  Start-Sleep -Seconds 5
  return $true
}

function Restart-Api {
  if (-not (Test-Path -LiteralPath $apiRestartScript)) { return $false }
  Write-Log "Restarting API (restart-api-selfhost.ps1)..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File $apiRestartScript -Root $Root
  Set-ApiRestartCooldown
  Start-Sleep -Seconds 3
  return (Test-ApiReady)
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
Write-Log "health watch started (PID $PID, interval=${IntervalSeconds}s)"

try {
  do {
    $appUrl = Get-AppUrl
    $apiUp = Test-ApiReady
    $tunnelUp = Test-TunnelRunning
    $publicUp = if ($apiUp) { Test-PublicReady $appUrl } else { $false }

    if (-not $apiUp) {
      if (Test-ApiRestartAllowed) {
        if (Restart-Api) {
          Write-Log "API restarted successfully"
          $apiUp = $true
          $tunnelUp = Test-TunnelRunning
          $publicUp = if ($apiUp) { Test-PublicReady $appUrl } else { $false }
        } else {
          Write-Log "API restart attempted but still not ready"
        }
      } else {
        Write-Log "API down - restart cooldown (max 1 restart per 10 min)"
      }
    }

    if ($apiUp -and -not $tunnelUp) {
      Write-Log "Tunnel down - restarting..."
      Restart-Tunnel | Out-Null
      if (Test-PublicReady $appUrl) { Write-Log "Tunnel OK; public site up" }
      else { Write-Log "Tunnel restarted; public site still not ready" }
    } elseif ($apiUp -and $tunnelUp -and -not $publicUp) {
      Write-Log "Public site down - restarting tunnel..."
      Restart-Tunnel | Out-Null
    } elseif ($apiUp -and $publicUp) {
      Write-Log "OK - API, tunnel, and public site healthy"
    }

    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSeconds
  } while ($true)
} finally {
  Write-Log "health watch stopped"
  if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
}
