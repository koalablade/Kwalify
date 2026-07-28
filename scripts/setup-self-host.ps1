# One-time self-host setup for closed beta from your PC (defaults: kwalify.net + Cloudflare Tunnel).
param(
  [string]$PublicUrl = "https://kwalify.net",
  [ValidateSet("cloudflare", "caddy", "direct")]
  [string]$Exposure = "cloudflare",
  [switch]$Firewall,
  [switch]$Startup,
  [switch]$Auto
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Set-EnvLine([string]$path, [string]$key, [string]$value) {
  $lines = if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path } else { @() }
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

function Normalize-PublicUrl([string]$raw) {
  $u = $raw.Trim().TrimEnd("/")
  if (-not $u) { throw "Public URL is required." }
  if (-not $u.StartsWith("https://")) {
    throw "Public URL must start with https:// (Spotify OAuth requires HTTPS)."
  }
  $parsed = [Uri]$u
  if ($parsed.Host -match '^(localhost|127\.0\.0\.1)$') {
    throw "Use your real public URL, not localhost."
  }
  return $parsed.GetLeftPart([UriPartial]::Authority)
}

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host ">> $msg" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "  KWALIFY SELF-HOST SETUP" -ForegroundColor Magenta
Write-Host "  Domain: kwalify.net | Exposure: Cloudflare Tunnel (no port forwarding)" -ForegroundColor DarkGray
Write-Host ""

if (-not $Auto) {
  if (-not $PublicUrl -or $PublicUrl -eq "https://kwalify.net") {
    $answer = Read-Host "Public URL [https://kwalify.net]"
    if ($answer.Trim()) { $PublicUrl = $answer.Trim() }
  }
  if (-not $Exposure) {
    Write-Host ""
    Write-Host "How will friends reach your PC?"
    Write-Host "  1) Cloudflare Tunnel (recommended)"
    Write-Host "  2) Caddy (port 443 forwarded on router)"
    Write-Host "  3) Direct HTTPS on this PC"
    $pick = Read-Host "Choice [1-3] (default 1)"
    $Exposure = switch ($pick) {
      "2" { "caddy" }
      "3" { "direct" }
      default { "cloudflare" }
    }
  }
  $fw = Read-Host "Open Windows Firewall for ports 5000/443? [Y/n]"
  if ($fw -eq "" -or $fw -match '^[Yy]') { $Firewall = $true }
  $su = Read-Host "Start Kwalify automatically when you log in? [Y/n]"
  if ($su -eq "" -or $su -match '^[Yy]') { $Startup = $true }
} else {
  if (-not $Firewall) { $Firewall = $true }
  if (-not $Startup) { $Startup = $true }
}

$siteUrl = Normalize-PublicUrl $PublicUrl
$redirectUri = "$siteUrl/api/auth/callback"
$hostName = ([Uri]$siteUrl).Host

$envPath = Join-Path $Root ".env"
$examplePath = Join-Path $Root ".env.example"
if (-not (Test-Path -LiteralPath $envPath) -and (Test-Path -LiteralPath $examplePath)) {
  Copy-Item -LiteralPath $examplePath -Destination $envPath
}

Write-Step "Updating .env for self-host"
Set-EnvLine $envPath "APP_URL" $siteUrl
Set-EnvLine $envPath "FRONTEND_URL" $siteUrl
Set-EnvLine $envPath "SPOTIFY_REDIRECT_URI" $redirectUri
Set-EnvLine $envPath "NODE_ENV" "production"
Set-EnvLine $envPath "BIND_HOST" "0.0.0.0"
Set-EnvLine $envPath "KWALIFY_HOST_MODE" "selfhost"
Set-EnvLine $envPath "KWALIFY_EXPOSURE" $Exposure
if (-not (Select-String -Path $envPath -Pattern '^\s*V3_PARALLEL_WORKERS=' -Quiet)) {
  Set-EnvLine $envPath "V3_PARALLEL_WORKERS" "4"
}
if (-not (Select-String -Path $envPath -Pattern '^\s*GENERATE_CONCURRENCY_LIMIT=' -Quiet)) {
  Set-EnvLine $envPath "GENERATE_CONCURRENCY_LIMIT" "2"
}
if (-not (Select-String -Path $envPath -Pattern '^\s*GENERATE_QUEUE_LIMIT=' -Quiet)) {
  Set-EnvLine $envPath "GENERATE_QUEUE_LIMIT" "4"
}
if (-not (Select-String -Path $envPath -Pattern '^\s*LOG_LEVEL=' -Quiet)) {
  Set-EnvLine $envPath "LOG_LEVEL" "info"
}

& (Join-Path $Root "scripts\ensure-beta-observability.ps1") -Root $Root
if (-not (Select-String -Path $envPath -Pattern '^\s*SENTRY_DSN=' -Quiet)) {
  Add-Content -LiteralPath $envPath -Value @"

# SENTRY_DSN=https://your-key@your-org.ingest.sentry.io/your-project
# SENTRY_ENVIRONMENT=beta
"@
}

Write-Host "  APP_URL=$siteUrl" -ForegroundColor Green
Write-Host "  SPOTIFY_REDIRECT_URI=$redirectUri" -ForegroundColor Green
Write-Host "  NODE_ENV=production" -ForegroundColor Green

if ($Exposure -eq "cloudflare") {
  Write-Step "Cloudflare Tunnel"
  $removeHosts = Join-Path $Root "scripts\remove-kwalify-hosts.ps1"
  if (Test-Path -LiteralPath $removeHosts) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $removeHosts -Quiet
  }
  try {
    & (Join-Path $Root "scripts\ensure-cloudflare-tunnel.ps1") -Root $Root -Hostname $hostName
  } catch {
    Write-Host ""
    Write-Host "  Tunnel setup needs one manual step." -ForegroundColor Yellow
    Write-Host "  Double-click: finish-cloudflare-login.bat" -ForegroundColor Yellow
    Write-Host "  (Log in to Cloudflare in your browser, then come back here)" -ForegroundColor DarkGray
  }
}

if ($Firewall) {
  Write-Step "Windows Firewall"
  try {
    & (Join-Path $Root "scripts\open-firewall.ps1")
  } catch {
    Write-Host "  Could not open firewall (run setup-self-host.bat as Administrator)" -ForegroundColor Yellow
  }
}

if ($Startup) {
  Write-Step "Auto-start at login"
  & (Join-Path $Root "scripts\register-startup-task.ps1") -Confirm
}

Write-Step "Daily database backup (3:00 AM)"
try {
  & (Join-Path $Root "scripts\schedule-db-backup.ps1")
} catch {
  Write-Host "  Could not register backup task (try running setup-self-host.bat as Administrator)" -ForegroundColor Yellow
}

Write-Step "Uptime checks every 5 minutes (while PC is on)"
try {
  & (Join-Path $Root "scripts\schedule-uptime-check.ps1")
} catch {
  Write-Host "  Could not register uptime task (optional - run schedule-uptime-check.ps1 as Administrator)" -ForegroundColor Yellow
}

Write-Step "Disable PC sleep on AC power"
try {
  & (Join-Path $Root "scripts\disable-pc-sleep.ps1")
} catch {
  Write-Host "  Could not change power plan - run disable-pc-sleep-admin.bat as Administrator" -ForegroundColor Yellow
}

Write-Step "Weekly maintenance (Sundays 10:00 AM)"
try {
  & (Join-Path $Root "scripts\schedule-weekly-maintenance.ps1")
} catch {
  Write-Host "  Could not register weekly task (optional — run weekly-maintenance.bat manually)" -ForegroundColor Yellow
}

$shortcutScript = Join-Path $Root "scripts\create-kwalify-shortcuts.ps1"
if (Test-Path -LiteralPath $shortcutScript) {
  Write-Step "Desktop shortcuts"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $shortcutScript -Root $Root
}

Write-Host ""
Write-Host "  SPOTIFY: confirm redirect URI in dashboard:" -ForegroundColor Yellow
Write-Host "    $redirectUri"
Start-Process "https://developer.spotify.com/dashboard" | Out-Null

Write-Host ""
Write-Host "  SETUP COMPLETE" -ForegroundColor Green
Write-Host "  Daily start: double-click start.bat (or Start Kwalify on Desktop)"
Write-Host "  Status: $siteUrl/status"
Write-Host ""
