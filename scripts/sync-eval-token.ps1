# Sync PLAYLIST_EVAL_TOKEN to local .env, GitHub Actions secret, and verify production.
# Usage (token via env — never commit or pass on the command line):
#   $env:PLAYLIST_EVAL_TOKEN = 'your-token'
#   .\scripts\sync-eval-token.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$token = $env:PLAYLIST_EVAL_TOKEN?.Trim()

if (-not $token) {
  Write-Error 'Set PLAYLIST_EVAL_TOKEN in the environment first.'
}

$envFile = Join-Path $root '.env'
$lines = @()
if (Test-Path $envFile) {
  $lines = Get-Content $envFile | Where-Object { $_ -notmatch '^\s*PLAYLIST_EVAL_TOKEN=' }
}
$lines += "PLAYLIST_EVAL_TOKEN=$token"
Set-Content -Path $envFile -Value ($lines -join "`n") -Encoding utf8
Write-Host "Updated $envFile"

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
  Push-Location $root
  $token | & $gh.Source secret set PLAYLIST_EVAL_TOKEN
  Pop-Location
  Write-Host 'GitHub secret PLAYLIST_EVAL_TOKEN updated.'
} else {
  Write-Warning 'gh CLI not found — set GitHub secret manually: Settings → Secrets → PLAYLIST_EVAL_TOKEN'
}

Write-Host ''
Write-Host 'Render: dashboard → kwalify-api → Environment → PLAYLIST_EVAL_TOKEN → Save → Manual Deploy'
Write-Host ''

$env:SMOKE_BASE_URL = 'https://kwalify.net'
$npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
if (Test-Path $npm) {
  Push-Location $root
  & $npm run verify:eval-token
  Pop-Location
} else {
  Write-Warning 'npm not found — run: npm run verify:eval-token after updating Render'
}
