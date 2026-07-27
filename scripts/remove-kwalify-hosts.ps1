# Remove kwalify.net from hosts file (needed for Cloudflare tunnel on this PC).
# Solo-dev setup adds 127.0.0.1 kwalify.net which blocks the real public site locally.
param([switch]$Quiet)

$ErrorActionPreference = "Stop"
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"

function Test-HostsOverride {
  $content = Get-Content $hostsPath -ErrorAction SilentlyContinue
  return [bool]($content | Where-Object { $_ -match '^\s*127\.0\.0\.1\s+kwalify\.net' })
}

if (-not (Test-HostsOverride)) {
  if (-not $Quiet) { Write-Host "  hosts: no kwalify.net override (OK for Cloudflare)" -ForegroundColor Green }
  return
}

if (-not $Quiet) {
  Write-Host "  Removing kwalify.net from hosts (Admin prompt)..." -ForegroundColor Yellow
  Write-Host "  Required so this PC uses Cloudflare instead of local dev HTTPS." -ForegroundColor DarkGray
}

$removeScript = @"
`$p = '$hostsPath'
`$lines = Get-Content `$p | Where-Object { `$_ -notmatch 'kwalify\.net' }
Set-Content -Path `$p -Value `$lines -Encoding ASCII
"@

$tmp = Join-Path $env:TEMP "kwalify-remove-hosts.ps1"
Set-Content $tmp $removeScript -Encoding UTF8
try {
  Start-Process powershell -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $tmp) -Wait
} catch {
  if (-not $Quiet) {
    Write-Host "  Could not remove hosts entry (cancelled or not Admin)." -ForegroundColor Yellow
    Write-Host "  Run as Admin: powershell -ExecutionPolicy Bypass -File scripts\remove-kwalify-hosts.ps1"
  }
  exit 1
}

Start-Sleep -Seconds 1
if (Test-HostsOverride) {
  if (-not $Quiet) { Write-Host "  hosts entry still present - try Run as Administrator" -ForegroundColor Yellow }
  exit 1
}

if (-not $Quiet) { Write-Host "  hosts: kwalify.net now resolves via Cloudflare DNS" -ForegroundColor Green }
