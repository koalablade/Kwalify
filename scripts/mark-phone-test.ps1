param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Note = "mobile flow OK"
)

$marker = Join-Path $Root "reports\.phone-test-verified"
$reports = Join-Path $Root "reports"
if (-not (Test-Path $reports)) { New-Item -ItemType Directory -Force -Path $reports | Out-Null }
$line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Note"
Set-Content -LiteralPath $marker -Value $line -Encoding UTF8
Write-Host "Marked phone test: $line" -ForegroundColor Green
