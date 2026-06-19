# Sync PLAYLIST_EVAL_TOKEN to local .env, GitHub Actions secret, and verify production.
param(
  [string]$Token
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$tokenValue = if ($Token) { $Token.Trim() } elseif ($env:PLAYLIST_EVAL_TOKEN) { $env:PLAYLIST_EVAL_TOKEN.Trim() } else { '' }

if (-not $tokenValue) {
  Write-Error 'Set PLAYLIST_EVAL_TOKEN in the environment or pass -Token.'
}

$envFile = Join-Path $root '.env'
$lines = @()
if (Test-Path $envFile) {
  $lines = Get-Content $envFile | Where-Object { $_ -notmatch '^\s*PLAYLIST_EVAL_TOKEN=' }
}
$lines += "PLAYLIST_EVAL_TOKEN=$tokenValue"
Set-Content -Path $envFile -Value ($lines -join "`n") -Encoding utf8
Write-Host "Updated $envFile"

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
  Push-Location $root
  $tokenValue | & $gh.Source secret set PLAYLIST_EVAL_TOKEN
  Pop-Location
  Write-Host 'GitHub secret PLAYLIST_EVAL_TOKEN updated.'
} else {
  Write-Warning 'gh CLI not found - set GitHub secret manually: Settings > Secrets > PLAYLIST_EVAL_TOKEN'
}

Write-Host ''
Write-Host 'Render: dashboard > kwalify-api > Environment > PLAYLIST_EVAL_TOKEN > Save > Manual Deploy'
Write-Host ''

$env:PLAYLIST_EVAL_TOKEN = $tokenValue
$env:SMOKE_BASE_URL = 'https://kwalify.net'
$npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
if (Test-Path $npm) {
  Push-Location $root
  & $npm run verify:eval-token
  Pop-Location
} else {
  Write-Warning 'npm not found - run: npm run verify:eval-token after updating Render'
}
