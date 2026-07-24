@echo off
title Kwalify
cd /d "%~dp0"

echo.
echo   ==========================================
echo    KWALIFY - double-click to start
echo   ==========================================
echo.

set "MODE=local"
if /I "%~1"=="domain" set "MODE=domain"
if /I "%~2"=="domain" set "MODE=domain"
if /I "%~1"=="build" set "BUILD=1"
if /I "%~2"=="build" set "BUILD=1"

set "KWLIFY_PS1=%TEMP%\kwalify-start-%RANDOM%.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$bat = Get-Content -LiteralPath '%~f0';" ^
  "$s = [array]::IndexOf($bat, ':SCRIPT');" ^
  "$e = [array]::IndexOf($bat, ':ENDSCRIPT');" ^
  "if ($s -lt 0 -or $e -lt 0) { throw 'start-kwalify.bat is corrupt' };" ^
  "$bat[($s+1)..($e-1)] | Set-Content -LiteralPath '%KWLIFY_PS1%' -Encoding UTF8"
if errorlevel 1 (
  echo Something went wrong preparing the launcher.
  pause
  exit /b 1
)

set "ARGS="
if defined BUILD set "ARGS=-Build"

powershell -NoProfile -ExecutionPolicy Bypass -File "%KWLIFY_PS1%" -Root "%CD%" -Mode "%MODE%" %ARGS%
set "ERR=%ERRORLEVEL%"
del "%KWLIFY_PS1%" 2>nul

if not "%ERR%"=="0" (
  echo.
  echo  Could not start. Read the messages above.
  echo.
  pause
  exit /b %ERR%
)

echo.
echo  Running in the "Kwalify API" window. Close that to stop.
echo  Press any key to close this launcher...
pause >nul
exit /b 0

:SCRIPT
param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [ValidateSet("local", "domain")]
  [string]$Mode = "local",
  [switch]$Build
)

$ErrorActionPreference = "Stop"
Set-Location $Root

function Step([string]$msg) {
  Write-Host ""
  Write-Host ">> $msg" -ForegroundColor Cyan
}

function PortOpen([int]$port) {
  try {
    return $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
  } catch { return $false }
}

function Set-EnvFileLine([string]$path, [string]$key, [string]$value) {
  $lines = if (Test-Path $path) { Get-Content $path } else { @() }
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match "^\s*$([regex]::Escape($key))\s*=") {
      $found = $true
      "$key=$value"
    } else { $line }
  }
  if (-not $found) { $out += "$key=$value" }
  Set-Content -LiteralPath $path -Value $out -Encoding UTF8
}

function Apply-DotEnvLine([string]$key, [string]$value) {
  Set-Item -Path "env:$key" -Value $value
}

function Load-DotEnvFile([string]$path) {
  if (-not (Test-Path $path)) { return }
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    if ($t -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $v = $Matches[2].Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    Apply-DotEnvLine $Matches[1] $v
  }
}

function Ensure-HostsEntry {
  $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
  $content = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
  if ($content -match 'kwalify\.net') { return $true }
  Write-Host "  Adding kwalify.net to hosts (Admin prompt)..." -ForegroundColor Yellow
  $addScript = @"
`$p = '$hostsPath'
if (-not (Select-String -Path `$p -Pattern 'kwalify\.net' -Quiet)) {
  Add-Content -Path `$p -Value "`n127.0.0.1 kwalify.net"
}
"@
  $tmp = Join-Path $env:TEMP "kwalify-hosts.ps1"
  Set-Content $tmp $addScript -Encoding UTF8
  try {
    Start-Process powershell -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $tmp) -Wait
  } catch {
    return $false
  }
  Start-Sleep -Seconds 1
  $content = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
  return ($content -match 'kwalify\.net')
}

function Ensure-LocalCerts {
  $cert = Join-Path $Root "kwalify.net.pem"
  $key = Join-Path $Root "kwalify.net-key.pem"
  if ((Test-Path $cert) -and (Test-Path $key)) { return $true }
  Write-Host "  Creating local HTTPS certs (one-time)..." -ForegroundColor Yellow
  $setup = Join-Path $Root "scripts\setup-local-domain.ps1"
  if (-not (Test-Path $setup)) { return $false }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $setup
  return ((Test-Path $cert) -and (Test-Path $key))
}

# --- 0. Node ---
Step "Checking Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  Node.js not found. Install from https://nodejs.org (LTS), then run this bat again."
  Start-Process "https://nodejs.org" | Out-Null
  exit 1
}
Write-Host "  node $((node -v))"

# --- 1. Postgres ---
Step "Checking PostgreSQL"
$pg = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pg) {
  Write-Host "  PostgreSQL not installed."
  Write-Host "  1) Install PostgreSQL 18 from https://www.postgresql.org/download/windows/"
  Write-Host "  2) Right-click this bat -> Run as administrator, OR run in Admin PowerShell:"
  Write-Host "       npm run db:setup-local-dev"
  Start-Process "https://www.postgresql.org/download/windows/" | Out-Null
  exit 1
}
if ($pg.Status -ne "Running") {
  Write-Host "  Starting $($pg.Name)..."
  Start-Service $pg.Name
  Start-Sleep -Seconds 2
}
Write-Host "  $($pg.Name): running"

# --- 2. .env ---
Step "Checking .env"
$envPath = Join-Path $Root ".env"
$examplePath = Join-Path $Root ".env.example"
if (-not (Test-Path $envPath)) {
  if (-not (Test-Path $examplePath)) { throw ".env.example missing" }
  Copy-Item $examplePath $envPath
  Write-Host "  Created .env from template."
}

$port = 5000
if ($Mode -eq "local") {
  Set-EnvFileLine $envPath "PORT" "5000"
  Set-EnvFileLine $envPath "NODE_ENV" "development"
  Set-EnvFileLine $envPath "APP_URL" "http://localhost:5000"
  Set-EnvFileLine $envPath "SPOTIFY_REDIRECT_URI" "http://localhost:5000/api/auth/callback"
  $siteUrl = "http://localhost:5000"
  $redirectUri = "http://localhost:5000/api/auth/callback"
} else {
  Set-EnvFileLine $envPath "APP_URL" "https://kwalify.net"
  Set-EnvFileLine $envPath "SPOTIFY_REDIRECT_URI" "https://kwalify.net/api/auth/callback"
  $siteUrl = "https://kwalify.net"
  $redirectUri = "https://kwalify.net/api/auth/callback"
}

Load-DotEnvFile $envPath
$port = if ($env:PORT) { [int]$env:PORT } else { 5000 }

if (-not $env:SPOTIFY_CLIENT_ID -or -not $env:SPOTIFY_CLIENT_SECRET) {
  Write-Host ""
  Write-Host "  SPOTIFY SETUP REQUIRED (one time):" -ForegroundColor Yellow
  Write-Host "  1. Open https://developer.spotify.com/dashboard"
  Write-Host "  2. Your app -> Settings"
  Write-Host "  3. Redirect URIs -> Add exactly:"
  Write-Host "       $redirectUri"
  Write-Host "  4. Copy Client ID and Client Secret into .env"
  Write-Host "  5. Run this bat again"
  Write-Host ""
  Start-Process "https://developer.spotify.com/dashboard" | Out-Null
  Start-Process notepad $envPath | Out-Null
  exit 1
}

# --- 3. Dependencies ---
if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Step "Installing dependencies (first time only)"
  npm ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# --- 4. Build ---
Step "Building"
$dist = Join-Path $Root "backend\dist\server.js"
if ($Build -or -not (Test-Path $dist)) {
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "  OK (delete backend\dist or pass build to force)"
}

# --- 5. API ---
Step "Starting server"
$localAppUrl = $siteUrl
$localRedirect = $redirectUri
$rootEsc = $Root.Replace("'", "''")

if (PortOpen $port) {
  Write-Host "  Stopping old server on port $port..."
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

$apiPs1 = Join-Path $env:TEMP "kwalify-api-$([Guid]::NewGuid().ToString('n')).ps1"
$apiBody = @"
`$host.UI.RawUI.WindowTitle = 'Kwalify API'
Set-Location '$rootEsc'
foreach (`$line in Get-Content '.env') {
  `$t = `$line.Trim()
  if (-not `$t -or `$t.StartsWith('#')) { continue }
  if (`$t -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    `$v = `$Matches[2].Trim().Trim('"').Trim("'")
    Set-Item "env:`$(`$Matches[1])" `$v
  }
}
`$env:APP_URL = '$localAppUrl'
`$env:SPOTIFY_REDIRECT_URI = '$localRedirect'
`$env:NODE_ENV = 'development'
`$env:PORT = '$port'
`$env:GIT_COMMIT = (git rev-parse HEAD 2>`$null)
if (-not `$env:GIT_COMMIT) { `$env:GIT_COMMIT = 'local-dev' }
Write-Host ''
Write-Host 'KWALIFY SERVER - keep this window OPEN' -ForegroundColor Green
Write-Host 'Site:' '$localAppUrl'
Write-Host 'Spotify callback:' '$localRedirect'
Write-Host ''
npm start
"@
Set-Content -LiteralPath $apiPs1 -Value $apiBody -Encoding UTF8
Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $apiPs1) -WorkingDirectory $Root | Out-Null

$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $rz = Invoke-RestMethod "http://127.0.0.1:$port/api/readyz" -TimeoutSec 3
    if ($rz.status -eq "ready" -or $rz.readiness -eq "ready") { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Host "  Server did not start in time. Check the Kwalify API window for errors."
  exit 1
}
Write-Host "  Server ready."

# --- 6. Open browser ---
Step "Opening site"
Write-Host "  $siteUrl"
Write-Host ""
Write-Host "  Spotify login uses: $redirectUri"
Write-Host "  (must be in your Spotify app Redirect URIs list)"
Write-Host ""

if ($Mode -eq "domain") {
  if (-not (Ensure-HostsEntry)) {
    Write-Host "  Could not add kwalify.net to hosts. Use local mode (default) instead."
    exit 1
  }
  if (-not (Ensure-LocalCerts)) {
    Write-Host "  Could not create HTTPS certs. Run: npm run setup:local-domain"
    exit 1
  }
  $proxy = Join-Path $Root "node_modules\.bin\local-ssl-proxy.cmd"
  $cert = Join-Path $Root "kwalify.net.pem"
  $key = Join-Path $Root "kwalify.net-key.pem"
  if (-not (Test-Path $proxy)) { throw "local-ssl-proxy missing - run npm ci" }
  Start-Process $siteUrl | Out-Null
  Write-Host "  HTTPS proxy running here (Ctrl+C stops proxy only)."
  & $proxy --source 443 --target $port --cert $cert --key $key
  exit 0
}

Start-Process $siteUrl | Out-Null
:ENDSCRIPT
