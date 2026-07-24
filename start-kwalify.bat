@echo off
title Kwalify
cd /d "%~dp0"

echo.
echo  ========================================
echo   Kwalify - local server (double-click)
echo  ========================================
echo   Starts: Postgres -^> API -^> site in browser
echo   Optional: https://kwalify.net (if set up)
echo.
echo   Options:  http     = localhost only, no SSL
echo             build    = rebuild before start
echo             nobuild  = skip rebuild
echo.

set "ARGS="
if /I "%~1"=="http" set "ARGS=%ARGS% -HttpOnly"
if /I "%~1"=="nobuild" set "ARGS=%ARGS% -SkipBuild"
if /I "%~1"=="build" set "ARGS=%ARGS% -Build"
if /I "%~2"=="http" set "ARGS=%ARGS% -HttpOnly"
if /I "%~2"=="nobuild" set "ARGS=%ARGS% -SkipBuild"
if /I "%~2"=="build" set "ARGS=%ARGS% -Build"
if /I "%~3"=="http" set "ARGS=%ARGS% -HttpOnly"
if /I "%~3"=="nobuild" set "ARGS=%ARGS% -SkipBuild"
if /I "%~3"=="build" set "ARGS=%ARGS% -Build"

set "KWLIFY_PS1=%TEMP%\kwalify-start-%RANDOM%.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$bat = Get-Content -LiteralPath '%~f0';" ^
  "$s = [array]::IndexOf($bat, ':SCRIPT');" ^
  "$e = [array]::IndexOf($bat, ':ENDSCRIPT');" ^
  "if ($s -lt 0 -or $e -lt 0) { throw 'start-kwalify.bat is corrupt (missing SCRIPT markers)' };" ^
  "$bat[($s+1)..($e-1)] | Set-Content -LiteralPath '%KWLIFY_PS1%' -Encoding UTF8"
if errorlevel 1 (
  echo Failed to prepare launcher.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%KWLIFY_PS1%" -Root "%CD%" %ARGS%
set "ERR=%ERRORLEVEL%"
del "%KWLIFY_PS1%" 2>nul

if not "%ERR%"=="0" (
  echo.
  echo Startup failed. See messages above.
  pause
  exit /b %ERR%
)

echo.
echo  Server is running in the "Kwalify API" window.
echo  Close that window to stop the site.
echo  Press any key to close this launcher...
pause >nul
exit /b 0

:SCRIPT
param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [switch]$HttpOnly,
  [switch]$SkipBuild,
  [switch]$Build
)

$ErrorActionPreference = "Stop"
Set-Location $Root

function Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function PortOpen([int]$port) {
  try {
    return $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
  } catch { return $false }
}

function Load-DotEnv([string]$dir) {
  $envFile = Join-Path $dir ".env"
  if (-not (Test-Path $envFile)) {
    $example = Join-Path $dir ".env.example"
    if (-not (Test-Path $example)) { throw ".env missing - copy .env.example first." }
    Copy-Item $example $envFile
    Write-Host "  Created .env from template - add Spotify keys for login."
  }
  foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    if ($t -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $v = $Matches[2].Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    Set-Item -Path "env:$($Matches[1])" -Value $v
  }
}

Step "1/5 PostgreSQL"
$pg = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pg) {
  Write-Host "  PostgreSQL not installed."
  Write-Host "  First time: install Postgres 18, then run as Admin:"
  Write-Host "    npm run db:setup-local-dev"
  exit 1
}
if ($pg.Status -ne "Running") {
  Write-Host "  Starting $($pg.Name)..."
  Start-Service $pg.Name
  Start-Sleep -Seconds 2
}
Write-Host "  $($pg.Name): running"

Step "2/5 Environment"
Load-DotEnv $root
$port = if ($env:PORT) { [int]$env:PORT } else { 5000 }

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Step "Dependencies"
  Write-Host "  Running npm ci (first time only)..."
  npm ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Step "3/5 Build"
$dist = Join-Path $root "backend\dist\server.js"
if ($SkipBuild -and (Test-Path $dist)) {
  Write-Host "  Skipped (nobuild)"
} elseif ($Build -or -not (Test-Path $dist)) {
  if ($Build) { Write-Host "  Forcing rebuild..." } else { Write-Host "  dist missing - building..." }
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "  dist OK (use 'build' arg to rebuild)"
}

Step "4/5 API on http://localhost:$port"
$startedApi = $false
if (PortOpen $port) {
  Write-Host "  Port $port in use - checking health..."
  try {
    $rz = Invoke-RestMethod "http://127.0.0.1:$port/api/readyz" -TimeoutSec 5
    Write-Host "  readyz OK (commit $($rz.commit))"
  } catch {
    Write-Host "  WARNING: port busy but API not healthy."
    exit 1
  }
} else {
  $rootLiteral = $Root.Replace("'", "''")
  $apiScript = @"
`$host.UI.RawUI.WindowTitle = 'Kwalify API'
Set-Location '$rootLiteral'
foreach (`$line in Get-Content '.env') {
  `$t = `$line.Trim()
  if (-not `$t -or `$t.StartsWith('#')) { continue }
  if (`$t -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    `$v = `$Matches[2].Trim().Trim('"').Trim("'")
    Set-Item "env:`$(`$Matches[1])" `$v
  }
}
`$env:GIT_COMMIT = (git rev-parse HEAD 2>`$null)
if (-not `$env:GIT_COMMIT) { `$env:GIT_COMMIT = 'local-dev' }
Write-Host ''
Write-Host 'Kwalify running - leave this window OPEN' -ForegroundColor Green
Write-Host "Site: http://localhost:$port"
Write-Host ''
npm start
"@
  $apiPs1 = Join-Path $env:TEMP "kwalify-api-$([Guid]::NewGuid().ToString('n')).ps1"
  Set-Content -LiteralPath $apiPs1 -Value $apiScript -Encoding UTF8
  Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $apiPs1) -WorkingDirectory $root | Out-Null
  $startedApi = $true

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
    Write-Host "  API did not start in 120s - check the Kwalify API window."
    exit 1
  }
  Write-Host "  readyz OK (commit $($rz.commit))"
}

$openUrl = "http://localhost:$port"
$cert = Join-Path $root "kwalify.net.pem"
$key = Join-Path $root "kwalify.net-key.pem"
$proxy = Join-Path $root "node_modules\.bin\local-ssl-proxy.cmd"
$useHttps = -not $HttpOnly

if ($useHttps -and (Test-Path $cert) -and (Test-Path $key) -and (Test-Path $proxy)) {
  Step "5/5 HTTPS https://kwalify.net"
  $hosts = Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" -Raw -ErrorAction SilentlyContinue
  if ($hosts -notmatch "kwalify\.net") {
    Write-Host "  kwalify.net not in hosts - using http://localhost:$port"
    Write-Host "  One-time Admin fix: scripts\add-kwalify-hosts.ps1"
  } elseif (PortOpen 443) {
    Write-Host "  Port 443 busy - using http://localhost:$port"
  } else {
    $openUrl = "https://kwalify.net"
    Write-Host "  Proxy running in THIS window (Ctrl+C stops proxy only)."
    Write-Host "  API stays in the Kwalify API window."
    Start-Process $openUrl | Out-Null
    & $proxy --source 443 --target $port --cert $cert --key $key
    exit 0
  }
}

Step "5/5 Open site"
Write-Host "  $openUrl"
if ($startedApi) { Write-Host "  API logs: Kwalify API window" }
Start-Process $openUrl | Out-Null
:ENDSCRIPT
