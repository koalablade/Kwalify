param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Note = "saved offline"
)

$marker = Join-Path $Root "reports\.secrets-backed-up"
$reports = Join-Path $Root "reports"
if (-not (Test-Path $reports)) { New-Item -ItemType Directory -Force -Path $reports | Out-Null }
$line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Note"
Set-Content -LiteralPath $marker -Value $line -Encoding UTF8
Write-Host "Marked secrets backup: $line" -ForegroundColor Green
Write-Host "Store .env, Cloudflare tunnel creds, and Spotify app secrets in your password manager." -ForegroundColor DarkGray
