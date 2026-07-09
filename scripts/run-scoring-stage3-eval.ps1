$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. "$PSScriptRoot\load-dotenv.ps1" -Root $root

$env:API_BASE_URL = "http://localhost:5000"
$env:PLAYLIST_EVAL_BASE_URL = "http://localhost:5000"
$commit = (git -C $root rev-parse HEAD).Trim()
if (-not $commit) { throw "Could not resolve git HEAD for eval preflight" }

node backend/dist/scripts/playlist-evaluation-harness.js `
  --base-url http://localhost:5000 `
  --out reports/playlist-evaluation/scoring-stage3-after `
  --benchmark-size 50 `
  --fresh `
  --expected-deployment-version $commit `
  --concurrency 1 `
  --delay-ms 1200 `
  --checkpoint-every 5

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node backend/dist/scripts/scoring-stage3-validation-analysis.js
