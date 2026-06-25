# Sync PLAYLIST_EVAL_TOKEN to local .env + GitHub secret. Requires explicit -Token from Render.
param(
  [Parameter(Mandatory = $true)]
  [string]$Token
)

$ErrorActionPreference = 'Stop'
$ExpectedLength = 21
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root '.env'

function Normalize-Token([string]$Raw) {
  if (-not $Raw) { return '' }
  return $Raw.Trim().Trim('"').Trim("'").Replace("`r", '').Replace("`n", '')
}

$tokenValue = Normalize-Token $Token

if (-not $tokenValue) {
  Write-Error 'Token is empty after normalization.'
}

if ($tokenValue.Length -ne $ExpectedLength) {
  Write-Error "PLAYLIST_EVAL_TOKEN must be exactly $ExpectedLength characters (got $($tokenValue.Length)). Copy the value from Render dashboard."
}

$lines = @()
if (Test-Path $envFile) {
  $lines = Get-Content $envFile | Where-Object { $_ -notmatch '^\s*PLAYLIST_EVAL_TOKEN=' }
}
$lines += "PLAYLIST_EVAL_TOKEN=$tokenValue"
Set-Content -Path $envFile -Value ($lines -join "`n") -Encoding utf8
Write-Host "Updated $envFile (token length: $($tokenValue.Length))"

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
Write-Host "Render must already have this same $ExpectedLength-char token. If not, paste there, Save, Manual Deploy."
Write-Host ''

Remove-Item Env:PLAYLIST_EVAL_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:SMOKE_EVAL_TOKEN -ErrorAction SilentlyContinue
$env:SMOKE_BASE_URL = 'https://kwalify.net'
$npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
if (Test-Path $npm) {
  Push-Location $root
  & $npm run verify:eval-token
  $exit = $LASTEXITCODE
  Pop-Location
  if ($exit -ne 0) { exit $exit }
} else {
  Write-Warning 'npm not found - run: npm run verify:eval-token'
}
