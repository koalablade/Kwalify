# Control: run the SAME prompts N times against ONE server at a fixed flag, to measure
# intrinsic run-to-run determinism (independent of worker parallelism). If flag=0 runs
# already differ from each other, the pipeline is nondeterministic across requests by
# design (timestamp-seeded), and cross-request byte-identity is not a valid equivalence test.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/control-determinism.ps1 -Flag 0 -Runs 2 -Prompts 3 -OutRoot reports/playlist-evaluation/control-seq

param(
  [string]$Flag = "0",
  [int]$Runs = 2,
  [int]$Prompts = 3,
  [string]$OutRoot = "reports/playlist-evaluation/control",
  [int]$Port = 5000
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. "$PSScriptRoot\load-dotenv.ps1" -Root $root
try { $env:GIT_COMMIT = (git -C $root rev-parse HEAD 2>$null) } catch {}
if (-not $env:GIT_COMMIT) { $env:GIT_COMMIT = "local-dev" }

$baseUrl = "http://localhost:$Port"
$outAbs = Join-Path $root $OutRoot
New-Item -ItemType Directory -Force -Path $outAbs | Out-Null

function Log([string]$m) { Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] $m" }

$env:V3_PARALLEL_CANDIDATES = $Flag
Log "starting API (flag=$Flag)"
$proc = Start-Process -FilePath "node" -ArgumentList "backend/dist/server.js" `
  -RedirectStandardOutput (Join-Path $outAbs "server.log") -RedirectStandardError (Join-Path $outAbs "server.log.err") `
  -PassThru -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(90)
$ready = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 1000
  try {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/readyz" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200 -and ($r.Content -match '"status"\s*:\s*"ready"')) { $ready = $true; break }
  } catch {}
}
if (-not $ready) { throw "API not ready" }
Log "API ready (pid=$($proc.Id))"

try {
  for ($i = 1; $i -le $Runs; $i += 1) {
    $outDir = Join-Path $outAbs "run-$i"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    Log "run $i/$Runs"
    $hargs = @(
      "backend/dist/scripts/playlist-evaluation-harness.js",
      "--limit", "$Prompts", "--strict-rc", "--base-url", $baseUrl,
      "--out", $outDir, "--fresh", "--delay-ms", "0", "--timeout-ms", "120000",
      "--max-http-retries", "2", "--cluster-fail-fast", "0", "--checkpoint-every", "5"
    )
    & node @hargs *> (Join-Path $outAbs "harness-run-$i.log")
    Log "run $i done (exit=$LASTEXITCODE)"
  }
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}
Log "CONTROL-COMPLETE flag=$Flag runs=$Runs prompts=$Prompts out=$OutRoot"
