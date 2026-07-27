# Fix kwalify.net DNS so traffic routes through your Cloudflare tunnel (not old hosting).
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$config = Join-Path $Root "deploy\cloudflared.yml"

$cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
if (-not (Test-Path $cf)) { $cf = "$env:ProgramFiles\cloudflared\cloudflared.exe" }
if (-not (Test-Path $cf)) { throw "cloudflared not found" }

$tunnelId = $null
if (Test-Path -LiteralPath $config) {
  $line = Select-String -Path $config -Pattern '^\s*tunnel:\s*' | Select-Object -First 1
  if ($line) { $tunnelId = ($line.Line -replace '^\s*tunnel:\s*', '').Trim() }
}
if (-not $tunnelId) { throw "deploy\cloudflared.yml missing tunnel id - run finish-cloudflare-login.bat" }

$cname = "$tunnelId.cfargotunnel.com"

Write-Host ""
Write-Host "  FIX CLOUDFLARE DNS" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Tunnel CNAME target: $cname" -ForegroundColor Cyan
Write-Host ""

Write-Host "  Trying automatic DNS update..." -ForegroundColor Yellow
foreach ($dnsHost in @("kwalify.net", "www.kwalify.net")) {
  $out = & $cf tunnel route dns -f kwalify $dnsHost 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0 -or $out -match "Added CNAME") {
    Write-Host "  OK: $dnsHost" -ForegroundColor Green
  } else {
    Write-Host "  Manual fix needed for: $dnsHost" -ForegroundColor Yellow
    Write-Host "    $out" -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "  If /status still 404, fix apex DNS manually in Cloudflare:" -ForegroundColor Yellow
Write-Host "    1. dash.cloudflare.com -> kwalify.net -> DNS -> Records"
Write-Host "    2. DELETE any A or AAAA record for @ (kwalify.net)"
Write-Host "    3. ADD CNAME: Name @  Target $cname  Proxy ON (orange cloud)"
Write-Host "    4. Run Start Kwalify (keeps tunnel running)"
Write-Host "    5. Test https://kwalify.net/status"
Write-Host ""

# Quick check
$appUrl = "https://kwalify.net"
try {
  $local = Invoke-RestMethod "http://localhost:5000/api/readyz" -TimeoutSec 3
  $public = Invoke-RestMethod "$appUrl/api/readyz" -TimeoutSec 8
  if ($local.uptimeMs -and $public.uptimeMs -and [math]::Abs($local.uptimeMs - $public.uptimeMs) -lt 60000) {
    Write-Host "  DNS looks correct (public and local API match)." -ForegroundColor Green
  } else {
    Write-Host "  Public site still hitting a different server than localhost:5000." -ForegroundColor Yellow
    Write-Host "  Local uptime: $($local.uptimeMs)ms  Public uptime: $($public.uptimeMs)ms"
  }
} catch {
  Write-Host "  Could not compare local vs public API (is Kwalify running?)." -ForegroundColor DarkYellow
}
Write-Host ""
