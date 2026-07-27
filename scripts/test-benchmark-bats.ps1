# Smoke-test benchmark .bat entry points without long runs.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
Set-Location $Root

$failures = @()
function Pass([string]$msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Fail([string]$msg) { Write-Host "  FAIL $msg" -ForegroundColor Red; $script:failures += $msg }

Write-Host ""
Write-Host "Benchmark bat smoke tests" -ForegroundColor Cyan
Write-Host ""

# --- 1. Required files exist ---
$required = @(
  "start-kwalify-benchmark.bat",
  "stop-kwalify-benchmark.bat",
  "run-benchmark-smoke.bat",
  "run-large-benchmark.bat",
  "run-live-benchmark.bat",
  "run-live-benchmark-resume.bat",
  "benchmark-package.bat",
  "benchmark-status.bat",
  "create-kwalify-benchmark-shortcuts.bat",
  "scripts\stop-benchmark.ps1",
  "scripts\benchmark-launcher-server.ps1",
  "scripts\spawn-benchmark.ps1",
  "frontend\public\benchmark-launcher.html"
)
foreach ($f in $required) {
  if (Test-Path -LiteralPath (Join-Path $Root $f)) { Pass $f } else { Fail "missing $f" }
}

# --- 2. package arg maps to suite package (not -Package only) ---
$bat = Get-Content -LiteralPath (Join-Path $Root "start-kwalify-benchmark.bat") -Raw
if ($bat -match 'if /I "%~1"=="package"[\s\S]*?set "PSARGS=-Suite package -NoMenu"') {
  Pass "start-kwalify-benchmark.bat package -> -Suite package"
} else {
  Fail "package arg mapping broken in start-kwalify-benchmark.bat"
}
if ($bat -notmatch 'set "PSARGS=-Suite package"\s*\r?\n\s*shift') {
  Pass "no duplicate dead package handler"
} else {
  Fail "duplicate package handler still present"
}

# --- 3. Redirect bats call main launcher ---
$redirects = @{
  "run-benchmark-smoke.bat" = "smoke"
  "run-large-benchmark.bat" = "large"
  "run-live-benchmark.bat" = "large"
  "run-live-benchmark-resume.bat" = "large resume"
  "benchmark-package.bat" = "package"
  "benchmark-status.bat" = "status"
}
foreach ($name in $redirects.Keys) {
  $content = Get-Content -LiteralPath (Join-Path $Root $name) -Raw
  $expect = $redirects[$name]
  if ($content -match "start-kwalify-benchmark\.bat" -and $content -match [regex]::Escape($expect)) {
    Pass "$name -> $expect"
  } else {
    Fail "$name redirect wrong (expected $expect)"
  }
}

# --- 4. Help exits cleanly ---
$help = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\run-kwalify-benchmark.ps1") -Help 2>&1
if ($LASTEXITCODE -eq 0 -and ($help -join "`n") -match "HUMAN PROMPT BENCHMARK") {
  Pass "run-kwalify-benchmark.ps1 -Help"
} else {
  Fail "run-kwalify-benchmark.ps1 -Help (exit $LASTEXITCODE)"
}

# --- 5. Status suite ---
$status = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\run-kwalify-benchmark.ps1") -Suite status -NoMenu 2>&1
if ($LASTEXITCODE -eq 0 -and ($status -join "`n") -match "KWALIFY BENCHMARK STATUS") {
  Pass "suite status"
} else {
  Fail "suite status (exit $LASTEXITCODE)"
}

# --- 6. Launcher API dry run ---
. (Join-Path $Root "scripts\benchmark-launcher-api.ps1") -Root $Root
$dry = Invoke-LauncherRun -Suite "smoke" -DryRun
if ($dry.ok -and $dry.dryRun) { Pass "Invoke-LauncherRun smoke dry-run" } else { Fail "Invoke-LauncherRun smoke dry-run" }
$dryPkg = Invoke-LauncherRun -Suite "package" -DryRun
if ($dryPkg.ok) { Pass "Invoke-LauncherRun package dry-run" } else { Fail "Invoke-LauncherRun package dry-run" }

# --- 7. Launcher server lifecycle ---
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\stop-benchmark.ps1") -Root $Root | Out-Null
Start-Sleep -Milliseconds 400
$serverJob = Start-Job -ScriptBlock {
  param($root)
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\benchmark-launcher-server.ps1") -Root $root -NoBrowser
} -ArgumentList $Root
Start-Sleep -Seconds 2
try {
  $ping = Invoke-RestMethod -Uri "http://127.0.0.1:5055/api/ping" -TimeoutSec 5
  if ($ping.ok -and $ping.launcherVersion) { Pass "launcher /api/ping" } else { Fail "launcher /api/ping response" }

  $buttons = Invoke-RestMethod -Uri "http://127.0.0.1:5055/api/buttons" -TimeoutSec 5
  if ($buttons.buttons.Count -ge 5) { Pass "launcher /api/buttons ($($buttons.buttons.Count))" } else { Fail "launcher /api/buttons count" }

  $runBody = @{ suite = "smoke" } | ConvertTo-Json
  try {
    $run = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5055/api/run" -Body $runBody -ContentType "application/json" -TimeoutSec 10
    if ($run.ok) { Pass "launcher /api/run smoke spawn" } else { Fail "launcher /api/run: $($run.error)" }
  } catch {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errBody = $reader.ReadToEnd() | ConvertFrom-Json
    if ($errBody.error -match "already running") {
      Pass "launcher /api/run blocked while running (expected if prior run active)"
    } else {
      Fail "launcher /api/run: $($errBody.error)"
    }
  }

  $spawnLog = Join-Path $Root "reports\benchmark-spawn.log"
  if (Test-Path $spawnLog) {
    $tail = Get-Content $spawnLog -Tail 3 -ErrorAction SilentlyContinue
    if ($tail -match "UI-SPAWN smoke") { Pass "spawn log records UI-SPAWN smoke" } else { Fail "spawn log missing UI-SPAWN smoke" }
  } else {
    Fail "benchmark-spawn.log not created"
  }
} catch {
  Fail "launcher server test: $($_.Exception.Message)"
} finally {
  Stop-Job $serverJob -ErrorAction SilentlyContinue
  Remove-Job $serverJob -Force -ErrorAction SilentlyContinue
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\stop-benchmark.ps1") -Root $Root | Out-Null
  Start-Sleep -Milliseconds 500
  $stillUp = $false
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:5055/api/ping" -TimeoutSec 2 | Out-Null
    $stillUp = $true
  } catch {}
  if (-not $stillUp) { Pass "stop-benchmark.ps1 stops launcher" } else { Fail "launcher still up after stop" }
}

# --- 8. benchmark-launcher.html has API constant ---
$html = Get-Content -LiteralPath (Join-Path $Root "frontend\public\benchmark-launcher.html") -Raw
if ($html -match "const API = ''") { Pass "benchmark-launcher.html API constant" } else { Fail "benchmark-launcher.html missing API constant" }

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Host "All benchmark bat checks passed." -ForegroundColor Green
  exit 0
}
Write-Host "$($failures.Count) check(s) failed:" -ForegroundColor Red
$failures | ForEach-Object { Write-Host "  - $_" }
exit 1
