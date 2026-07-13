# End-to-end V3_PARALLEL_CANDIDATES equivalence validation.
#
# 1. Start API with V3_PARALLEL_CANDIDATES=0, run a 25-prompt benchmark (sequential baseline).
# 2. Restart API with V3_PARALLEL_CANDIDATES=1, run the identical 25 prompts N times.
# 3. Sample server RSS throughout the parallel phase (peak memory).
#
# Outputs land under -OutRoot; the Node aggregator (parallel-validation-report.js) then
# compares tracks / ordering / metadata / diagnostics / Pipeline Authority and reports metrics.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/validate-parallel-equivalence.ps1 [-Iterations 20]

param(
  [int]$Iterations = 20,
  [int]$Prompts = 25,
  [string]$OutRoot = "reports/playlist-evaluation/parallel-validation",
  [int]$Port = 5000
)

# Continue (not Stop): the harness/server write progress to stderr, which PowerShell would
# otherwise promote to a terminating error. Critical failures use explicit `throw`.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. "$PSScriptRoot\load-dotenv.ps1" -Root $root
try { $env:GIT_COMMIT = (git -C $root rev-parse HEAD 2>$null) } catch {}
if (-not $env:GIT_COMMIT) { $env:GIT_COMMIT = "local-dev" }

$baseUrl = "http://localhost:$Port"
$outAbs = Join-Path $root $OutRoot
New-Item -ItemType Directory -Force -Path $outAbs | Out-Null
$memFile = Join-Path $outAbs "mem-samples.txt"
"" | Set-Content $memFile

function Write-Log([string]$msg) {
  $ts = (Get-Date).ToString("HH:mm:ss")
  Write-Host "[$ts] $msg"
}

function Start-Api([string]$flag, [string]$logPath) {
  $env:V3_PARALLEL_CANDIDATES = $flag
  Write-Log "starting API (V3_PARALLEL_CANDIDATES=$flag) -> $logPath"
  $proc = Start-Process -FilePath "node" -ArgumentList "backend/dist/server.js" `
    -RedirectStandardOutput $logPath -RedirectStandardError "$logPath.err" `
    -PassThru -WindowStyle Hidden
  # Wait for readiness.
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    try {
      $r = Invoke-WebRequest -Uri "$baseUrl/api/readyz" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200 -and ($r.Content -match '"status"\s*:\s*"ready"')) {
        Write-Log "API ready (pid=$($proc.Id))"
        return $proc
      }
    } catch { }
  }
  throw "API did not become ready within 90s (flag=$flag)"
}

function Stop-Api($proc) {
  if ($proc -and -not $proc.HasExited) {
    Write-Log "stopping API (pid=$($proc.Id))"
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 2
}

function Sample-Memory($proc) {
  if ($proc -and -not $proc.HasExited) {
    try {
      $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
      if ($p) { "$((Get-Date).ToString('o')),$($p.WorkingSet64)" | Add-Content $memFile }
    } catch {}
  }
}

function Run-Harness([string]$outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $hargs = @(
    "backend/dist/scripts/playlist-evaluation-harness.js",
    "--limit", "$Prompts",
    "--strict-rc",
    "--base-url", $baseUrl,
    "--out", $outDir,
    "--fresh",
    "--delay-ms", "0",
    "--timeout-ms", "120000",
    "--max-http-retries", "2",
    "--cluster-fail-fast", "0",
    "--checkpoint-every", "5"
  )
  $logName = ("harness-" + (Split-Path $outDir -Leaf) + ".log")
  & node @hargs *> (Join-Path $outAbs $logName)
  return $LASTEXITCODE
}

# ── Phase 1: sequential baseline ─────────────────────────────────────────────
$seqDir = Join-Path $outAbs "seq"
$server = Start-Api "0" (Join-Path $outAbs "server-seq.log")
try {
  Write-Log "running sequential baseline ($Prompts prompts)"
  $rc = Run-Harness $seqDir
  Write-Log "sequential baseline done (exit=$rc)"
} finally {
  Stop-Api $server
}

# ── Phase 2: parallel, repeated ──────────────────────────────────────────────
$parDir = Join-Path $outAbs "par"
New-Item -ItemType Directory -Force -Path $parDir | Out-Null
$server = Start-Api "1" (Join-Path $outAbs "server-par.log")
try {
  for ($i = 1; $i -le $Iterations; $i += 1) {
    Sample-Memory $server
    $iterDir = Join-Path $parDir "par-$i"
    Write-Log "parallel iteration $i/$Iterations"
    $rc = Run-Harness $iterDir
    Sample-Memory $server
    Write-Log "parallel iteration $i done (exit=$rc)"
  }
} finally {
  Stop-Api $server
}

Write-Log "VALIDATION-COMPLETE outRoot=$OutRoot iterations=$Iterations prompts=$Prompts"
