# Start Kwalify locally: PostgreSQL -> build -> API -> optional HTTPS proxy (kwalify.net).
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-kwalify-local.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-kwalify-local.ps1 -HttpOnly
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-kwalify-local.ps1 -SkipBuild

param(
  [switch]$SkipBuild,
  [switch]$HttpOnly,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-PortListening([int]$Port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    return $null -ne $conn
  } catch {
    return $false
  }
}

Write-Step "1/5 PostgreSQL"
$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pgService) {
  Write-Host "PostgreSQL service not found."
  Write-Host "  Install PostgreSQL 18, then run (Admin): npm run db:setup-local-dev"
  Write-Host "  Or: powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-postgres.ps1"
  exit 1
}
if ($pgService.Status -ne "Running") {
  Write-Host "Starting $($pgService.Name)..."
  Start-Service $pgService.Name
  Start-Sleep -Seconds 2
}
Write-Host "  $($pgService.Name): Running"

Write-Step "2/5 Environment (.env)"
$envPath = Join-Path $root ".env"
if (-not (Test-Path $envPath)) {
  $example = Join-Path $root ".env.example"
  if (-not (Test-Path $example)) {
    throw ".env missing and no .env.example template found."
  }
  Copy-Item $example $envPath
  Write-Host "  Created .env from .env.example - add Spotify credentials before login works."
}
. "$PSScriptRoot\load-dotenv.ps1" -Root $root
$port = if ($env:PORT) { [int]$env:PORT } else { 5000 }

Write-Step "3/5 Build"
if ($SkipBuild -and (Test-Path "backend\dist\server.js")) {
  Write-Host "  Skipped (-SkipBuild)"
} elseif (-not (Test-Path "backend\dist\server.js")) {
  Write-Host "  backend\dist\server.js missing - building..."
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "  dist present (use -SkipBuild to skip rebuild; delete dist to force build)"
}

Write-Step "4/5 API server (http://localhost:$port)"
$apiStartedHere = $false
if (Test-PortListening $port) {
  Write-Host "  Port $port already in use - assuming API is already running."
  $apiStartedHere = $false
} else {
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $root "scripts\start-api.ps1")
  ) -WorkingDirectory $root -WindowStyle Normal | Out-Null
  $apiStartedHere = $true
  $deadline = (Get-Date).AddSeconds(90)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $rz = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/readyz" -TimeoutSec 3
      if ($rz.status -eq "ok" -or $rz.readiness -eq "ready") {
        $ready = $true
        break
      }
    } catch {}
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    Write-Host "  API did not become ready within 90s. Check the 'Kwalify API' window for errors."
    exit 1
  }
  Write-Host "  readyz OK (commit $($rz.commit))"
}

$useHttps = -not $HttpOnly
$cert = Join-Path $root "kwalify.net.pem"
$key = Join-Path $root "kwalify.net-key.pem"
$proxyCmd = Join-Path $root "node_modules\.bin\local-ssl-proxy.cmd"
$openUrl = "http://localhost:$port"

if ($useHttps -and (Test-Path $cert) -and (Test-Path $key) -and (Test-Path $proxyCmd)) {
  Write-Step "5/5 HTTPS proxy (https://kwalify.net -> :$port)"
  $hosts = Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" -Raw -ErrorAction SilentlyContinue
  if ($hosts -notmatch "kwalify\.net") {
    Write-Host "  WARNING: kwalify.net not in hosts file."
    Write-Host "  Run as Admin: powershell -ExecutionPolicy Bypass -File .\scripts\add-kwalify-hosts.ps1"
    Write-Host "  Falling back to http://localhost:$port"
    $useHttps = $false
  } elseif (Test-PortListening 443) {
    Write-Host "  Port 443 already in use - skipping proxy (use http://localhost:$port or stop the other listener)."
    $useHttps = $false
  } else {
    $openUrl = "https://kwalify.net"
    Write-Host "  Starting SSL proxy in this window. Press Ctrl+C to stop proxy only."
    Write-Host "  (API keeps running in the 'Kwalify API' window.)"
    if (-not $NoBrowser) {
      Start-Process $openUrl | Out-Null
    }
    & $proxyCmd --source 443 --target $port --cert $cert --key $key
    exit 0
  }
}

Write-Step "5/5 Site URL"
Write-Host "  Open: $openUrl"
Write-Host "  Health: http://127.0.0.1:$port/api/readyz"
Write-Host "  Preflight: npm run preflight:api"
if ($apiStartedHere) {
  Write-Host "  API logs: 'Kwalify API' command window"
}
if (-not $NoBrowser) {
  Start-Process $openUrl | Out-Null
}
