# Start Kwalify API on PORT from .env (default 5000). Loads .env first so token matches benchmarks.
param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$host.UI.RawUI.WindowTitle = "Kwalify API"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. "$PSScriptRoot\load-dotenv.ps1" -Root $root

if ($Build -or -not (Test-Path "backend\dist\server.js")) {
  Write-Host "Building..."
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$port = if ($env:PORT) { $env:PORT } else { "5000" }
try {
  $env:GIT_COMMIT = (git -C $root rev-parse HEAD 2>$null)
} catch {}
if (-not $env:GIT_COMMIT) { $env:GIT_COMMIT = "local-dev" }
Write-Host ""
Write-Host "Kwalify API starting on http://localhost:$port"
$tokenLen = if ($env:PLAYLIST_EVAL_TOKEN) { $env:PLAYLIST_EVAL_TOKEN.Length } else { 0 }
Write-Host "  .env PLAYLIST_EVAL_TOKEN loaded (length $tokenLen)"
Write-Host "  Leave this window open while benchmarking."
Write-Host "  Verify in another terminal: npm run verify:eval-token:local"
Write-Host ""

npm start
