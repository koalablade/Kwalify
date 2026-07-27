# Idempotent pre-flight: first-time setup + Cloudflare + hosts cleanup.
# Called automatically by start.bat before the server starts.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [switch]$SetupOnly
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
Set-Location $Root

function Step([string]$msg) {
  Write-Host ""
  Write-Host ">> $msg" -ForegroundColor Cyan
}

function Find-Cloudflared {
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

function Test-SelfHostConfigured([string]$envPath) {
  if (-not (Test-Path -LiteralPath $envPath)) { return $false }
  $lines = Get-Content -LiteralPath $envPath
  $mode = ($lines | Where-Object { $_ -match '^\s*KWALIFY_HOST_MODE\s*=' } | Select-Object -First 1) -replace '^\s*KWALIFY_HOST_MODE\s*=\s*', ''
  $appUrl = ($lines | Where-Object { $_ -match '^\s*APP_URL\s*=' } | Select-Object -First 1) -replace '^\s*APP_URL\s*=\s*', ''
  return ($mode -eq "selfhost" -and $appUrl -like "https://*")
}

function Ensure-CloudflaredInstalled {
  if (Find-Cloudflared) { return }
  Step "Installing cloudflared"
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements | Out-Host
  if (-not (Find-Cloudflared)) {
    throw "cloudflared not found. Install: winget install Cloudflare.cloudflared"
  }
}

function Ensure-CloudflareLogin([string]$cf) {
  $cert = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"
  if (Test-Path -LiteralPath $cert) { return }

  Write-Host ""
  Write-Host "  ONE-TIME CLOUDFLARE LOGIN" -ForegroundColor Yellow
  Write-Host "  1. A browser window will open"
  Write-Host "  2. Click the kwalify.net row on the authorize page"
  Write-Host "  3. Wait for success before closing the browser"
  Write-Host ""
  Read-Host "  Press Enter to open Cloudflare login"

  & $cf tunnel login
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $cert)) {
    throw "Cloudflare login failed. Run start.bat again after authorizing kwalify.net."
  }
  Write-Host "  Cloudflare login OK" -ForegroundColor Green
}

function Ensure-TunnelConfig([string]$cf) {
  $config = Join-Path $Root "deploy\cloudflared.yml"
  if (Test-Path -LiteralPath $config) { return }

  Step "Creating Cloudflare tunnel"
  $hostname = "kwalify.net"
  $envPath = Join-Path $Root ".env"
  if (Test-Path -LiteralPath $envPath) {
    $line = Select-String -Path $envPath -Pattern '^\s*APP_URL=' | Select-Object -First 1
    if ($line -and $line.Line -match 'https?://([^/]+)') { $hostname = $Matches[1] }
  }
  & (Join-Path $Root "scripts\ensure-cloudflare-tunnel.ps1") -Root $Root -Hostname $hostname
  if (-not (Test-Path -LiteralPath $config)) {
    throw "Could not create deploy\cloudflared.yml"
  }
}

# --- main ---
Write-Host ""
Write-Host "  KWALIFY START" -ForegroundColor Magenta
Write-Host "  One double-click: setup (if needed) + server + tunnel" -ForegroundColor DarkGray
Write-Host ""

$envPath = Join-Path $Root ".env"
$examplePath = Join-Path $Root ".env.example"
if (-not (Test-Path -LiteralPath $envPath) -and (Test-Path -LiteralPath $examplePath)) {
  Copy-Item -LiteralPath $examplePath -Destination $envPath
  Write-Host "  Created .env from .env.example" -ForegroundColor Green
}

if (-not (Test-SelfHostConfigured $envPath)) {
  Step "First-time self-host setup"
  & (Join-Path $Root "scripts\setup-self-host.ps1") -PublicUrl "https://kwalify.net" -Exposure cloudflare -Auto
}

$removeHosts = Join-Path $Root "scripts\remove-kwalify-hosts.ps1"
if (Test-Path -LiteralPath $removeHosts) {
  Step "Checking hosts file"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $removeHosts -Quiet
}

Ensure-CloudflaredInstalled
$cf = Find-Cloudflared
Ensure-CloudflareLogin $cf
Ensure-TunnelConfig $cf

$marker = Join-Path $Root ".kwalify-startup-tasks-done"
if (-not (Test-Path -LiteralPath $marker)) {
  Step "One-time startup tasks"
  try { & (Join-Path $Root "scripts\schedule-db-backup.ps1") } catch {}
  # Startup-at-logon is opt-in: scripts\register-startup-task.ps1 -Confirm
  Set-Content -LiteralPath $marker -Value (Get-Date -Format o) -Encoding ASCII
}

$shortcutScript = Join-Path $Root "scripts\create-kwalify-shortcuts.ps1"
if (Test-Path -LiteralPath $shortcutScript) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $shortcutScript -Root $Root | Out-Null
}

$reports = Join-Path $Root "reports"
if (-not (Test-Path -LiteralPath $reports)) {
  New-Item -ItemType Directory -Force -Path $reports | Out-Null
}

Write-Host ""
Write-Host "  Pre-flight OK" -ForegroundColor Green
Write-Host ""

if ($SetupOnly) { exit 0 }
