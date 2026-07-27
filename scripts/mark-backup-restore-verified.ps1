param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Note = "verified manually"
)

$marker = Join-Path $Root "reports\.backup-restore-verified"
$reports = Join-Path $Root "reports"
if (-not (Test-Path $reports)) { New-Item -ItemType Directory -Force -Path $reports | Out-Null }
$line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Note"
Set-Content -LiteralPath $marker -Value $line -Encoding UTF8
Write-Host "Marked backup restore as verified: $line" -ForegroundColor Green
