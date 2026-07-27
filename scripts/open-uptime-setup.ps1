# Open UptimeRobot signup and show setup steps (external monitor - 15 min one-time).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$Root = (Resolve-Path $Root).Path
$appUrl = "https://kwalify.net"
$envPath = Join-Path $Root ".env"
if (Test-Path -LiteralPath $envPath) {
  $line = Select-String -Path $envPath -Pattern '^\s*APP_URL=' | Select-Object -First 1
  if ($line) {
    $appUrl = ($line.Line -replace '^\s*APP_URL=', '').Trim().TrimEnd('/')
  }
}

Write-Host ""
Write-Host "  UPTIME ROBOT SETUP" -ForegroundColor Magenta
Write-Host "  1. Sign up / log in at uptimerobot.com"
Write-Host "  2. Add Monitor -> HTTPS -> $appUrl/api/readyz (5 min interval)"
Write-Host "  3. Add your email as alert contact"
Write-Host "  4. After saving, run: scripts\mark-external-uptime.ps1"
Write-Host ""

Start-Process "https://uptimerobot.com/login" | Out-Null
Start-Process "$appUrl/api/readyz" | Out-Null
