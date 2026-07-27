# DEPRECATED: Use start.bat in the repo root instead.
# Start Kwalify locally at https://kwalify.net (Spotify OAuth requires this domain).
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-kwalify-local.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-kwalify-local.ps1 -HttpOnly
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-kwalify-local.ps1 -SkipBuild

param(
  [switch]$SkipBuild,
  [switch]$Build,
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
$examplePath = Join-Path $root ".env.example"
if (-not (Test-Path -LiteralPath $envPath)) {
  if (Test-Path -LiteralPath $examplePath) {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
    Write-Host "  Created .env from .env.example - add Spotify credentials before login works."
  } else {
    @"
DATABASE_URL=postgresql://kwalify:kwalify@localhost:5432/kwalify
SESSION_SECRET=change-me-to-a-random-string-at-least-32-characters
PORT=5000
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback
NODE_ENV=development
APP_URL=https://kwalify.net
"@ | Set-Content -LiteralPath $envPath -Encoding UTF8
    Write-Host "  Created .env with default local settings - add Spotify credentials before login works."
  }
}
if (-not $HttpOnly) {
  $content = Get-Content $envPath -Raw
  $content = $content -replace 'SPOTIFY_REDIRECT_URI=.*', 'SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback'
  if ($content -notmatch 'APP_URL=') {
    $content += "`nAPP_URL=https://kwalify.net"
  } else {
    $content = $content -replace 'APP_URL=.*', 'APP_URL=https://kwalify.net'
  }
  Set-Content -Path $envPath -Value $content.TrimEnd()
}
. "$PSScriptRoot\load-dotenv.ps1" -Root $root
$port = if ($env:PORT) { [int]$env:PORT } else { 5000 }

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Step "Dependencies (node_modules)"
  Write-Host "  node_modules missing - running npm ci (first time only)..."
  npm ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Step "3/5 Build"
if ($SkipBuild -and (Test-Path "backend\dist\server.js")) {
  Write-Host "  Skipped (-SkipBuild)"
} elseif ($Build -or -not (Test-Path "backend\dist\server.js")) {
  if ($Build) {
    Write-Host "  Rebuilding (build flag)..."
  } else {
    Write-Host "  backend\dist\server.js missing - building..."
  }
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "  dist present (pass build to force rebuild; nobuild to skip)"
}

Write-Step "4/5 API server (http://localhost:$port)"
$apiStartedHere = $false
if (Test-PortListening $port) {
  Write-Host "  Port $port already in use - assuming API is already running."
  try {
    $rz = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/readyz" -TimeoutSec 5
    Write-Host "  readyz OK (commit $($rz.commit))"
  } catch {
    Write-Host "  WARNING: port $port is open but /api/readyz did not respond."
  }
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

if ($useHttps) {
  if (-not ((Test-Path $cert) -and (Test-Path $key))) {
    Write-Host "  Missing TLS certs. Run: npm run setup:local-domain"
    exit 1
  }
  if (-not (Test-Path $proxyCmd)) {
    Write-Host "  local-ssl-proxy missing. Run: npm ci"
    exit 1
  }
  $hosts = Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" -Raw -ErrorAction SilentlyContinue
  if ($hosts -notmatch "kwalify\.net") {
    Write-Host "  kwalify.net not in hosts file (required for Spotify login)."
    Write-Host "  Run as Admin: powershell -ExecutionPolicy Bypass -File .\scripts\add-kwalify-hosts.ps1"
    exit 1
  }
  if (Test-PortListening 443) {
    Write-Host "  Port 443 already in use - stop the other listener and retry."
    exit 1
  }
  $openUrl = "https://kwalify.net"
  Write-Step "5/5 HTTPS proxy (https://kwalify.net -> :$port)"
  Write-Host "  Starting SSL proxy in this window. Press Ctrl+C to stop proxy only."
  Write-Host "  (API keeps running in the 'Kwalify API' window.)"
  if (-not $NoBrowser) {
    Start-Process $openUrl | Out-Null
  }
  & $proxyCmd --source 443 --target $port --cert $cert --key $key
  exit 0
}

Write-Step "5/5 Site URL (HttpOnly debug mode)"
Write-Host "  Open: $openUrl"
Write-Host "  Health: http://127.0.0.1:$port/api/readyz"
Write-Host "  Preflight: npm run preflight:api"
Write-Host ""
Write-Host "  KEEP OPEN: 'Kwalify API' PowerShell window (API + frontend site)"
Write-Host "  Close that window to stop the server."
if ($apiStartedHere) {
  Write-Host "  API was started in a new window titled 'Kwalify API'."
}
if (-not $NoBrowser) {
  Start-Process $openUrl | Out-Null
}
