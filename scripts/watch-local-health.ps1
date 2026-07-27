# Lightweight watchdog for local self-host: API + Cloudflare tunnel + public URL.
# Does NOT restart the API (avoids duplicate processes). Restarts tunnel when API is up but public is down.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [int]$IntervalSeconds = 300,
  [switch]$Once
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path $Root).Path
$logPath = Join-Path $Root "kwalify-watchdog.log"
$tunnelScript = Join-Path $Root "scripts\run-cloudflare-tunnel.ps1"

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
  $pidFile = Join-Path $Root "reports\.cloudflared.pid"
  if (Test-Path -LiteralPath $pidFile) {
    $pidVal = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($pidVal -and (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)) { return $true }
  }
  return [bool](Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1)
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
Write-Log "watchdog started (interval=${IntervalSeconds}s, once=$Once)"

do {
  $appUrl = Get-AppUrl
  $apiUp = Test-ApiReady
  $tunnelUp = Test-TunnelRunning
  $publicUp = if ($apiUp) { Test-PublicReady $appUrl } else { $false }

  if (-not $apiUp) {
    Write-Log "API down — start Kwalify (start.bat). Watchdog will not auto-start API."
  } elseif (-not $tunnelUp) {
    Write-Log "API up, tunnel down — restarting tunnel..."
    if (Test-Path -LiteralPath $tunnelScript) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $tunnelScript -Root $Root
      Start-Sleep -Seconds 5
      $publicUp = Test-PublicReady $appUrl
      if ($publicUp) { Write-Log "Tunnel restarted; public site OK" }
      else { Write-Log "Tunnel restarted but public site still not ready" }
    }
  } elseif (-not $publicUp) {
    Write-Log "API + tunnel up but $appUrl not ready — trying tunnel restart..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File $tunnelScript -Root $Root
  } else {
    Write-Log "OK — API, tunnel, and public site healthy"
  }

  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSeconds
} while ($true)

Write-Log "watchdog stopped"
