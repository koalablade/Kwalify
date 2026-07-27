# Start Cloudflare Tunnel for Kwalify (background). Requires deploy/cloudflared.yml
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$config = Join-Path $Root "deploy\cloudflared.yml"
$pidFile = Join-Path $Root "reports\.cloudflared.pid"
$logFile = Join-Path $Root "reports\cloudflared.log"

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
    throw "Missing deploy\cloudflared.yml - run finish-cloudflare-login.bat"
  }
}

$cloudflared = Find-CloudflaredExe
if (-not $cloudflared) {
  throw "cloudflared not found. Run setup-self-host.bat"
}

$reports = Join-Path $Root "reports"
if (-not (Test-Path -LiteralPath $reports)) {
  New-Item -ItemType Directory -Force -Path $reports | Out-Null
}

if (Test-Path -LiteralPath $pidFile) {
  $oldPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Host "  Cloudflare tunnel already running (PID $oldPid)"
    return
  }
}

# Clean stale pid file
if (Test-Path -LiteralPath $pidFile) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

# Start-Process -WindowStyle Minimized can exit immediately on some Windows setups.
# cmd /c start keeps cloudflared alive in its own console window.
$argLine = "tunnel --config `"$config`" run --logfile `"$logFile`" --loglevel info"
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList @(
  "/c", "start", "`"Cloudflare Tunnel`"", "/MIN", "`"$cloudflared`"", $argLine
) -WorkingDirectory $Root -WindowStyle Hidden -PassThru

Start-Sleep -Seconds 3
$tunnelProc = Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $tunnelProc) {
  throw "cloudflared exited immediately. Run manually: cloudflared tunnel --config deploy\cloudflared.yml run"
}

Set-Content -LiteralPath $pidFile -Value $tunnelProc.Id -Encoding ASCII
Write-Host "  Cloudflare tunnel started (PID $($tunnelProc.Id))" -ForegroundColor Green
Write-Host "  Log: reports\cloudflared.log" -ForegroundColor DarkGray

# Confirm connector registered with Cloudflare (avoids false "started" when process dies).
$connected = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $info = & $cloudflared tunnel info kwalify 2>&1 | Out-String
    if ($info -match "CONNECTOR ID") { $connected = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}
if (-not $connected) {
  Write-Host "  Warning: tunnel process started but no active Cloudflare connection yet." -ForegroundColor Yellow
  Write-Host "  Check reports\cloudflared.log or the Cloudflare Tunnel window." -ForegroundColor Yellow
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
    Write-Host "  Warning: public URL may still point at old DNS (not this PC)." -ForegroundColor Yellow
    Write-Host "  Run fix-cloudflare-dns.bat if /status returns 404." -ForegroundColor Yellow
  }
}
