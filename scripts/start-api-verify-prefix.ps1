# Start local API with playlist name prefix for Spotify verify benches.
param(
  [string]$Prefix = "test 2"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. "$PSScriptRoot\load-dotenv.ps1" -Root $root

$env:PLAYLIST_VERIFY_FOLDER_PREFIX = $Prefix
try {
  $env:GIT_COMMIT = (git -C $root rev-parse HEAD 2>$null)
} catch {}
if (-not $env:GIT_COMMIT) { $env:GIT_COMMIT = "local-dev" }

Write-Host "Starting API with PLAYLIST_VERIFY_FOLDER_PREFIX='$Prefix'"
npm start
