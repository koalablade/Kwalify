# Idempotent closed-beta observability defaults: OPS token, LOG_LEVEL, Sentry placeholders.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "SilentlyContinue"
$Root = (Resolve-Path $Root).Path
$envPath = Join-Path $Root ".env"
if (-not (Test-Path -LiteralPath $envPath)) { exit 0 }

function Set-EnvLine([string]$path, [string]$key, [string]$value) {
  $lines = Get-Content -LiteralPath $path
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

function Test-EnvKeySet([string]$key) {
  $line = Select-String -Path $envPath -Pattern "^\s*$([regex]::Escape($key))\s*=\s*\S" | Select-Object -First 1
  return [bool]$line
}

function New-RandomToken([int]$byteLength = 24) {
  $bytes = New-Object byte[] $byteLength
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([BitConverter]::ToString($bytes) -replace "-", "").ToLower()
}

$changed = $false
$mode = (Select-String -Path $envPath -Pattern '^\s*KWALIFY_HOST_MODE\s*=\s*(\S+)' | Select-Object -First 1)
$isSelfHost = $mode -and $mode.Matches.Groups[1].Value -eq "selfhost"

if ($isSelfHost -and -not (Test-EnvKeySet "LOG_LEVEL")) {
  Set-EnvLine $envPath "LOG_LEVEL" "info"
  Write-Host "  Set LOG_LEVEL=info (self-host beta diagnostics)" -ForegroundColor Green
  $changed = $true
}

# V39–V41 compound-intent path: code is always in the build but inactive without these flags.
if ($isSelfHost) {
  foreach ($pair in @(
    @("PLAYLIST_CONTRACT_WORLD_GATE", "1"),
    @("PLAYLIST_CONTRACT_V40", "1"),
    @("PLAYLIST_CONTRACT_V41", "1")
  )) {
    if (-not (Test-EnvKeySet $pair[0])) {
      Set-EnvLine $envPath $pair[0] $pair[1]
      Write-Host "  Set $($pair[0])=$($pair[1]) (compound-intent pipeline)" -ForegroundColor Green
      $changed = $true
    }
  }
}

if (-not (Test-EnvKeySet "OPS_METRICS_TOKEN")) {
  $token = New-RandomToken
  Set-EnvLine $envPath "OPS_METRICS_TOKEN" $token
  Write-Host "  Generated OPS_METRICS_TOKEN (saved to .env)" -ForegroundColor Green
  $appUrl = (Select-String -Path $envPath -Pattern '^\s*APP_URL\s*=\s*(\S+)' | Select-Object -First 1)
  $base = if ($appUrl) { $appUrl.Matches.Groups[1].Value.TrimEnd('/') } else { "https://kwalify.net" }
  Write-Host "  Full metrics: $base/status?ops=<token>" -ForegroundColor DarkGray
  $changed = $true
}

if (-not (Select-String -Path $envPath -Pattern '^\s*SENTRY_DSN=' -Quiet)) {
  Add-Content -LiteralPath $envPath -Value @"

# Optional: uncomment after creating a free project at https://sentry.io
# SENTRY_DSN=https://your-key@your-org.ingest.sentry.io/your-project
# SENTRY_ENVIRONMENT=beta
"@
  Write-Host "  Added Sentry placeholders to .env (uncomment SENTRY_DSN to enable)" -ForegroundColor DarkGray
  $changed = $true
}

if (-not $changed) {
  Write-Host "  Beta observability env OK" -ForegroundColor DarkGray
}
