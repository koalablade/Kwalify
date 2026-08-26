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
  "create-kwalify-shortcuts.bat",
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
$statusText = $status -join "`n"
if ($LASTEXITCODE -eq 0 -and $statusText -match "KWALIFY BENCHMARK STATUS") {
  Pass "suite status"
} else {
  Write-Host $statusText
  Fail "suite status (exit $LASTEXITCODE)"
}

# --- 6. Launcher API dry run ---
. (Join-Path $Root "scripts\benchmark-launcher-api.ps1") -Root $Root
$dry = Invoke-LauncherRun -Suite "smoke" -DryRun
if ($dry.ok -and $dry.dryRun) { Pass "Invoke-LauncherRun smoke dry-run" } else { Fail "Invoke-LauncherRun smoke dry-run" }
$dryPkg = Invoke-LauncherRun -Suite "package" -DryRun
if ($dryPkg.ok) { Pass "Invoke-LauncherRun package dry-run" } else { Fail "Invoke-LauncherRun package dry-run" }

# --- 7. Main-site benchmark API (port 5000) + legacy 5055 redirect ---
# Live API/redirect checks need a running Kwalify instance. Skip in CI / when the
# API is down so this remains a bat/script smoke test, not a live-server test.
$apiUp = $false
try {
  $null = Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/healthz" -TimeoutSec 3
  $apiUp = $true
} catch {}

if (-not $apiUp) {
  Pass "main benchmark API skipped (API not running — start.bat required for live checks)"
  Pass "legacy port 5055 redirect skipped (API not running)"
} else {
  try {
    $ping = Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/benchmark/ping" -TimeoutSec 5 -Headers @{ Host = "localhost" }
    if ($ping.ok -and $ping.url -eq "/benchmark") { Pass "main /api/benchmark/ping" } else { Fail "main /api/benchmark/ping response" }

    $buttons = Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/benchmark/buttons" -TimeoutSec 5 -Headers @{ Host = "localhost" }
    if ($buttons.buttons.Count -ge 5) { Pass "main /api/benchmark/buttons ($($buttons.buttons.Count))" } else { Fail "main /api/benchmark/buttons count" }

    $sw = [Diagnostics.Stopwatch]::StartNew()
    $state = Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/benchmark/state" -TimeoutSec 10 -Headers @{ Host = "localhost" }
    $ms = $sw.ElapsedMilliseconds
    if ($null -ne $state.savedPresets -and $state.apiUrl -match "127\.0\.0\.1") {
      if ($ms -lt 3000) { Pass "main /api/benchmark/state (${ms}ms)" } else { Fail "main /api/benchmark/state slow (${ms}ms)" }
    } else { Fail "main /api/benchmark/state missing bridge fields" }

    $preview = Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/benchmark/chat" -Method POST -ContentType "application/json" -Body '{"message":"preview smoke"}' -TimeoutSec 90 -Headers @{ Host = "localhost" }
    if ($preview.ok -and $preview.reply -match "preview") { Pass "main /api/benchmark/chat preview" } else { Fail "main /api/benchmark/chat preview" }
  } catch {
    Fail "main benchmark API: $($_.Exception.Message)"
  }

  $redirectJob = Start-Job -ScriptBlock {
    param($root)
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\ensure-benchmark-redirect.ps1") -Root $root
  } -ArgumentList $Root
  $redirectOk = $false
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:5055/" -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
      if ($resp.StatusCode -eq 302 -and $resp.Headers.Location -match "/benchmark") { $redirectOk = $true; break }
    } catch {
      if ($_.Exception.Response.StatusCode.value__ -eq 302) { $redirectOk = $true; break }
    }
  }
  if ($redirectOk) { Pass "legacy port 5055 redirects to /benchmark" } else { Fail "legacy port 5055 redirect" }
  try {
    Stop-Job $redirectJob -ErrorAction SilentlyContinue
    Remove-Job $redirectJob -Force -ErrorAction SilentlyContinue
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\stop-benchmark.ps1") -Root $Root | Out-Null
  } catch {}
}

# --- 8. benchmark-launcher uses main-site API (external JS for CSP) ---
$html = Get-Content -LiteralPath (Join-Path $Root "frontend\public\benchmark-launcher.html") -Raw
$js = Get-Content -LiteralPath (Join-Path $Root "frontend\public\js\benchmark-launcher.js") -Raw
if ($html -match 'src="/js/benchmark-launcher\.js"') { Pass "benchmark-launcher.html external JS" } else { Fail "benchmark-launcher.html missing external JS" }
if ($js -match "const API = '/api/benchmark'") { Pass "benchmark-launcher.js main-site API" } else { Fail "benchmark-launcher.js missing main-site API" }
if ($js -match "showActivity") { Pass "benchmark-launcher.js activity panel" } else { Fail "benchmark-launcher.js missing activity feedback" }
if ($js -match "kwalify\.net/benchmark") { Pass "benchmark-launcher.js kwalify.net URL" } else { Fail "benchmark-launcher.js missing kwalify.net URL" }

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Host "All benchmark bat checks passed." -ForegroundColor Green
  exit 0
}
Write-Host "$($failures.Count) check(s) failed:" -ForegroundColor Red
$failures | ForEach-Object { Write-Host "  - $_" }
exit 1
