# Log local + public health checks (for weekly maintenance and manual runs).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [switch]$Quiet
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path $Root).Path
$logPath = Join-Path $Root "reports\uptime-check.log"
$reportsDir = Join-Path $Root "reports"
if (-not (Test-Path -LiteralPath $reportsDir)) {
  New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
}

$appUrl = $null
$envPath = Join-Path $Root ".env"
if (Test-Path -LiteralPath $envPath) {
  $line = Select-String -Path $envPath -Pattern '^\s*APP_URL=' | Select-Object -First 1
  if ($line) { $appUrl = ($line.Line -replace '^\s*APP_URL=', '').Trim().TrimEnd('/') }
}

function Test-Ready([string]$url) {
  try {
    $rz = Invoke-RestMethod "$url/api/readyz" -TimeoutSec 8
    return ($rz.status -eq "ready" -or $rz.readiness -eq "ready")
  } catch { return $false }
}

$localOk = Test-Ready "http://127.0.0.1:5000"
$publicOk = if ($appUrl) { Test-Ready $appUrl } else { $false }
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$line = "$stamp  local=$localOk  public=$publicOk  url=$appUrl"
Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8

if ($Quiet) { exit 0 }

Write-Host ""
Write-Host "  UPTIME CHECK" -ForegroundColor Magenta
if ($localOk) { Write-Host "  [OK]   Local API (127.0.0.1:5000)" -ForegroundColor Green }
else { Write-Host "  [!!]   Local API down - run start.bat" -ForegroundColor Red }

if ($appUrl) {
  if ($publicOk) { Write-Host "  [OK]   Public site ($appUrl)" -ForegroundColor Green }
  else { Write-Host "  [!!]   Public site down - check tunnel / repair-tunnel.bat" -ForegroundColor Red }
} else {
  Write-Host "  [?]    APP_URL not set in .env" -ForegroundColor Yellow
}

Write-Host "  Log: reports\uptime-check.log" -ForegroundColor DarkGray
Write-Host ""

if (-not $localOk) { exit 1 }
if ($appUrl -and -not $publicOk) { exit 1 }
exit 0
