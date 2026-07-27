# Install cloudflared if needed and create deploy/cloudflared.yml for kwalify.net
param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [Parameter(Mandatory = $true)]
  [string]$Hostname
)

$ErrorActionPreference = "Stop"
$config = Join-Path $Root "deploy\cloudflared.yml"
$cloudflaredDir = Join-Path $env:USERPROFILE ".cloudflared"

function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe",
    "$env:ProgramFiles\Cloudflare\cloudflared\cloudflared.exe",
    "$env:ProgramFiles(x86)\Cloudflare\cloudflared\cloudflared.exe"
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

function Refresh-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($machine -or $user) {
    $env:Path = ($machine, $user) -join ";"
  }
}

function Install-Cloudflared {
  Write-Host "  Installing cloudflared via winget..." -ForegroundColor Yellow
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements | Out-Host
  Refresh-PathFromRegistry
  return Find-Cloudflared
}

function Invoke-Cloudflared([string]$exe, [string[]]$cfArgs) {
  if (-not (Test-Path -LiteralPath $cloudflaredDir)) {
    New-Item -ItemType Directory -Force -Path $cloudflaredDir | Out-Null
  }
  $prev = $env:TUNNEL_ORIGIN_CERT
  if (-not $prev) {
    $certPath = Join-Path $cloudflaredDir "cert.pem"
    if (Test-Path -LiteralPath $certPath) {
      $env:TUNNEL_ORIGIN_CERT = $certPath
    }
  }
  $out = & $exe @cfArgs 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 0 -and $code -ne $null) {
    throw ($out | Out-String).Trim()
  }
  return $out
}

$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
  $cloudflared = Install-Cloudflared
}
if (-not $cloudflared) {
  throw "cloudflared not found. Install manually: winget install Cloudflare.cloudflared"
}
Write-Host "  cloudflared: $cloudflared" -ForegroundColor Green

$credFiles = @()
if (Test-Path -LiteralPath $cloudflaredDir) {
  $credFiles = Get-ChildItem -LiteralPath $cloudflaredDir -Filter "*.json" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^[0-9a-f-]+\.json$' }
}

$tunnelId = $null
$credPath = $null
$tunnelName = "kwalify"

function Find-TunnelByName([string]$exe, [string]$name) {
  try {
    $listOut = & $exe tunnel list 2>&1 | Out-String
    if ($listOut -match "$name\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})") {
      return $Matches[1]
    }
  } catch {}
  return $null
}

if ($credFiles.Count -gt 0) {
  $credPath = $credFiles[0].FullName
  $tunnelId = [System.IO.Path]::GetFileNameWithoutExtension($credFiles[0].Name)
  Write-Host "  Using existing tunnel credentials: $tunnelId" -ForegroundColor Green
} else {
  $existingId = Find-TunnelByName $cloudflared $tunnelName
  if ($existingId) {
    $candidate = Join-Path $cloudflaredDir "$existingId.json"
    if (Test-Path -LiteralPath $candidate) {
      $tunnelId = $existingId
      $credPath = $candidate
      Write-Host "  Found existing tunnel '$tunnelName': $tunnelId" -ForegroundColor Green
    }
  }
}

if (-not $tunnelId -or -not $credPath) {
  $certPath = Join-Path $cloudflaredDir "cert.pem"
  if (-not (Test-Path -LiteralPath $certPath)) {
    Write-Host ""
    Write-Host "  Cloudflare login required (one time)." -ForegroundColor Yellow
    Write-Host "  Run: finish-cloudflare-login.bat" -ForegroundColor Yellow
    throw "Cloudflare cert.pem missing - run finish-cloudflare-login.bat"
  }

  Write-Host "  Creating tunnel '$tunnelName'..." -ForegroundColor Yellow
  $createOut = $null
  try {
    $createOut = Invoke-Cloudflared $cloudflared @("tunnel", "create", $tunnelName)
  } catch {
    $existingId = Find-TunnelByName $cloudflared $tunnelName
    if ($existingId) {
      $tunnelId = $existingId
      $candidate = Join-Path $cloudflaredDir "$existingId.json"
      if (Test-Path -LiteralPath $candidate) { $credPath = $candidate }
      Write-Host "  Tunnel '$tunnelName' already exists: $tunnelId" -ForegroundColor Green
    } else {
      throw
    }
  }

  if (-not $tunnelId) {
    $createText = if ($createOut) { ($createOut | Out-String) } else { "" }
    if ($createText -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
      $tunnelId = $Matches[1]
    }
  }

  $credFiles = Get-ChildItem -LiteralPath $cloudflaredDir -Filter "*.json" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^[0-9a-f-]+\.json$' }
  if ($credFiles.Count -gt 0) {
    if (-not $credPath) { $credPath = $credFiles[0].FullName }
    if (-not $tunnelId) { $tunnelId = [System.IO.Path]::GetFileNameWithoutExtension($credFiles[0].Name) }
  }
  if (-not $tunnelId -or -not $credPath) {
    throw "Could not create tunnel. Run: finish-cloudflare-login.bat"
  }
}

Write-Host "  Routing DNS: $Hostname -> tunnel..." -ForegroundColor Yellow
try {
  Invoke-Cloudflared $cloudflared @("tunnel", "route", "dns", "-f", "kwalify", $Hostname) | Out-Null
  Write-Host "  DNS route OK: $Hostname" -ForegroundColor Green
} catch {
  Write-Host "  DNS route failed for $Hostname - update DNS manually in Cloudflare dashboard." -ForegroundColor Yellow
  Write-Host "  CNAME $Hostname -> $tunnelId.cfargotunnel.com (proxied)" -ForegroundColor DarkGray
}

$extraHosts = @()
if ($Hostname -notmatch '^www\.') {
  $extraHosts += "www.$Hostname"
}
foreach ($extra in $extraHosts) {
  try {
    Invoke-Cloudflared $cloudflared @("tunnel", "route", "dns", "-f", "kwalify", $extra) | Out-Null
    Write-Host "  DNS route OK: $extra" -ForegroundColor Green
  } catch {
    Write-Host "  DNS route failed for $extra." -ForegroundColor DarkYellow
  }
}

$ingressLines = @()
foreach ($h in @($Hostname) + $extraHosts) {
  $ingressLines += "  - hostname: $h"
  $ingressLines += "    service: http://127.0.0.1:5000"
}
$ingressLines += "  - service: http_status:404"

$yamlLines = @(
  "# Auto-generated by ensure-cloudflare-tunnel.ps1",
  "tunnel: $tunnelId",
  "credentials-file: $credPath",
  "",
  "ingress:"
) + $ingressLines
New-Item -ItemType Directory -Force -Path (Split-Path $config) | Out-Null
Set-Content -LiteralPath $config -Value ($yamlLines -join "`n") -Encoding UTF8
Write-Host "  Wrote deploy\cloudflared.yml" -ForegroundColor Green
