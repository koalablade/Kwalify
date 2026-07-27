param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Service = "UptimeRobot"
)

$marker = Join-Path $Root "reports\.external-uptime-configured"
$reports = Join-Path $Root "reports"
if (-not (Test-Path $reports)) { New-Item -ItemType Directory -Force -Path $reports | Out-Null }
$line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Service"
Set-Content -LiteralPath $marker -Value $line -Encoding UTF8
Write-Host "Marked external uptime monitor configured: $line" -ForegroundColor Green
