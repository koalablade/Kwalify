# Start Cloudflare Tunnel for Kwalify (background). Requires deploy/cloudflared.yml
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$config = Join-Path $Root "deploy\cloudflared.yml"
$pidFile = Join-Path $Root "reports\.cloudflared.pid"
$helper = Join-Path $Root "scripts\start-cloudflare-tunnel.cmd"

function Find-CloudflaredExe {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
  )) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

function Test-TunnelConnected([string]$cf) {
  try {
    $info = & $cf tunnel info kwalify 2>&1 | Out-String
    return ($info -match "CONNECTOR ID")
  } catch { return $false }
}

function Get-RunningTunnelProcess {
  return Get-Process -Name cloudflared -ErrorAction SilentlyContinue |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
}

if (-not (Test-Path -LiteralPath $config)) {
  $cert = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"
  if (Test-Path -LiteralPath $cert) {
    Write-Host "  Tunnel config missing - creating deploy\cloudflared.yml..." -ForegroundColor Yellow
    $ensure = Join-Path $Root "scripts\ensure-cloudflare-tunnel.ps1"
    $hostname = "kwalify.net"
    $envPath = Join-Path $Root ".env"
    if (Test-Path -LiteralPath $envPath) {
      $appLine = Select-String -Path $envPath -Pattern '^\s*APP_URL=' | Select-Object -First 1
      if ($appLine -and $appLine.Line -match 'https?://([^/]+)') {
        $hostname = $Matches[1]
      }
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $ensure -Root $Root -Hostname $hostname
  }
  if (-not (Test-Path -LiteralPath $config)) {
    throw "Missing deploy\cloudflared.yml - run start.bat (setup runs automatically)"
  }
}

$cloudflared = Find-CloudflaredExe
if (-not $cloudflared) {
  throw "cloudflared not found. Run start.bat (installs automatically)"
}

$reports = Join-Path $Root "reports"
if (-not (Test-Path -LiteralPath $reports)) {
  New-Item -ItemType Directory -Force -Path $reports | Out-Null
}

# Already running?
$existing = Get-RunningTunnelProcess
if ($existing -and (Test-TunnelConnected $cloudflared)) {
  Set-Content -LiteralPath $pidFile -Value $existing.Id -Encoding ASCII
  Write-Host "  Cloudflare tunnel already running (PID $($existing.Id))" -ForegroundColor Green
  return
}

# Stale pid file / dead process
if (Test-Path -LiteralPath $pidFile) {
  $oldPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
  if ($oldPid) { Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# Launch via .cmd helper (direct call - Start-Process quoting breaks paths with spaces).
if (-not (Test-Path -LiteralPath $helper)) {
  throw "Missing scripts\start-cloudflare-tunnel.cmd"
}

& $helper $cloudflared $config
if ($LASTEXITCODE -ne 0) {
  throw "Could not launch cloudflared (helper exit $LASTEXITCODE). Path: $cloudflared"
}

# Wait for process to appear (can take a few seconds on slow disks).
$tunnelProc = $null
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  $tunnelProc = Get-RunningTunnelProcess
  if ($tunnelProc) { break }
}

if (-not $tunnelProc) {
  throw @"
cloudflared did not stay running.
Try manually in a new window:
  cd /d $Root
  cloudflared tunnel --config deploy\cloudflared.yml run
"@
}

Set-Content -LiteralPath $pidFile -Value $tunnelProc.Id -Encoding ASCII
Write-Host "  Cloudflare tunnel started (PID $($tunnelProc.Id))" -ForegroundColor Green

$connected = $false
for ($i = 0; $i -lt 12; $i++) {
  if (Test-TunnelConnected $cloudflared) { $connected = $true; break }
  Start-Sleep -Seconds 2
}
if ($connected) {
  Write-Host "  Tunnel connected to Cloudflare" -ForegroundColor Green
} else {
  Write-Host "  Warning: tunnel process running but not connected yet." -ForegroundColor Yellow
  Write-Host "  Check the 'Cloudflare Tunnel' window for errors." -ForegroundColor Yellow
}

# Best-effort: wait for public readyz if APP_URL is set
$appUrl = $null
$envPath = Join-Path $Root ".env"
if (Test-Path -LiteralPath $envPath) {
  $line = Select-String -Path $envPath -Pattern '^\s*APP_URL=' | Select-Object -First 1
  if ($line) { $appUrl = ($line.Line -replace '^\s*APP_URL=', '').Trim().TrimEnd('/') }
}
if ($appUrl) {
  $deadline = (Get-Date).AddSeconds(45)
  $matched = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $local = Invoke-RestMethod "http://localhost:5000/api/readyz" -TimeoutSec 3
      $pub = Invoke-RestMethod "$appUrl/api/readyz" -TimeoutSec 5
      if (($pub.status -eq "ready" -or $pub.readiness -eq "ready") -and $local.uptimeMs -and $pub.uptimeMs) {
        if ([math]::Abs($local.uptimeMs - $pub.uptimeMs) -lt 120000) {
          Write-Host "  Public site ready: $appUrl" -ForegroundColor Green
          $matched = $true
          break
        }
      }
    } catch {}
    Start-Sleep -Seconds 2
  }
  if (-not $matched) {
    Write-Host "  Warning: public URL may still be propagating." -ForegroundColor Yellow
  }
}
