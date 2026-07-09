# Run live local benchmark with preflight checks.
param(
  [ValidateSet("6h", "opening-curator", "smoke")]
  [string]$Suite = "6h",
  [switch]$SpawnLocal,
  [switch]$Resume,
  [switch]$SkipPreflight
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. "$PSScriptRoot\load-dotenv.ps1" -Root $root

if (-not $env:SMOKE_SPOTIFY_USER_ID) {
  $env:SMOKE_SPOTIFY_USER_ID = "koalablade"
  Write-Host "SMOKE_SPOTIFY_USER_ID not in .env - using default koalablade for this run."
  Write-Host "Add SMOKE_SPOTIFY_USER_ID=koalablade to .env to persist."
}

New-Item -ItemType Directory -Force -Path "reports\playlist-evaluation\live-6h" | Out-Null

if (-not $SkipPreflight -and -not $SpawnLocal) {
  try {
    & "$PSScriptRoot\preflight-api.ps1"
  } catch {
    Write-Warning $_.Exception.Message
    Write-Host "Retrying with auto-spawn on :5001 ..."
    $SpawnLocal = $true
  }
}

Write-Host "Building..."
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

switch ($Suite) {
  "6h" {
    $args = @("backend/dist/scripts/live-6h-benchmark.js", "--local")
    if ($SpawnLocal) { $args += "--spawn-local" }
    if ($Resume) { $args += "--resume" } else { $args += "--fresh" }
    Write-Host "Starting 6-hour suite (250 prompts)..."
    node @args
  }
  "opening-curator" {
    $args = @("backend/dist/scripts/opening-curator-v2-benchmark.js", "--live", "--local")
    if ($SpawnLocal) { $args += "--spawn-local" }
    Write-Host "Starting Opening Curator v2 benchmark (31 prompts)..."
    node @args
  }
  "smoke" {
    & "$PSScriptRoot\preflight-api.ps1"
    Write-Host "Smoke generate (single prompt)..."
    node -e @"
const token = process.env.PLAYLIST_EVAL_TOKEN;
const user = process.env.SMOKE_SPOTIFY_USER_ID || 'koalablade';
fetch('http://localhost:5000/api/generate?audit=1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-kwalify-evaluation-token': token },
  body: JSON.stringify({ vibe: 'chill evening', mode: 'balanced', length: 25, auditMode: true, spotifyUserId: user }),
}).then(async r => {
  const d = await r.json();
  console.log(JSON.stringify({ status: r.status, code: d.code, tracks: (d.tracks||[]).length, success: d.success }, null, 2));
  process.exit(r.ok && (d.tracks||[]).length >= 5 ? 0 : 1);
}).catch(e => { console.error(e.message); process.exit(1); });
"@
  }
}

exit $LASTEXITCODE
