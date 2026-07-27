# Desktop shortcuts - daily use. Run create-kwalify-shortcuts.bat to refresh.
param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$icon = Join-Path $Root "frontend\public\favicon.svg"

function New-Shortcut([string]$name, [string]$target, [string]$comment, [string]$args = "") {
  $lnk = Join-Path $desktop "$name.lnk"
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $target
  $sc.WorkingDirectory = $Root
  $sc.WindowStyle = 1
  $sc.Description = $comment
  if ($args) { $sc.Arguments = $args }
  if (Test-Path -LiteralPath $icon) { $sc.IconLocation = "$icon,0" }
  $sc.Save()
  Write-Host "  OK: $name" -ForegroundColor Green
}

$removeNames = @(
  "Start Kwalify", "Start Kwalify (Beta)", "Start Kwalify (solo dev)",
  "Stop Kwalify", "Stop Benchmark", "Run Benchmark", "Start Benchmark",
  "Check Beta Ready", "Open Status Page",
  "1 - Cloudflare Login (once)", "2 - Open Firewall (once, Admin)",
  "3 - Start Kwalify Beta", "Finish Cloudflare Setup",
  "Kwalify Benchmark", "Kwalify Large Benchmark", "Kwalify Benchmark Status",
  "Kwalify Benchmark Smoke", "Package Benchmark Results", "Run Kwalify Benchmark",
  "Benchmark Kwalify", "Kwalify benchmark", "Start Kwalify (Admin)",
  "Quick Check", "Benchmark Results"
)

Write-Host ""
Write-Host "  Refreshing Desktop shortcuts..." -ForegroundColor Cyan
foreach ($name in $removeNames) {
  $lnk = Join-Path $desktop "$name.lnk"
  if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }
}

$envPath = Join-Path $Root ".env"
$startBat = Join-Path $Root "start.bat"
if (-not (Test-Path -LiteralPath $startBat)) {
  $startBat = Join-Path $Root "start-kwalify.bat"
}
$benchBat = Join-Path $Root "start-kwalify-benchmark.bat"
$stopBenchBat = Join-Path $Root "stop-kwalify-benchmark.bat"
$stopBat = Join-Path $Root "stop-kwalify.bat"
$checkBat = Join-Path $Root "check-beta-ready.bat"
$statusBat = Join-Path $Root "open-status-page.bat"
$adminBat = Join-Path $Root "start-kwalify-admin.bat"

if (-not (Test-Path -LiteralPath $startBat)) { throw "start.bat not found in $Root" }
if (-not (Test-Path -LiteralPath $benchBat)) { throw "start-kwalify-benchmark.bat not found in $Root" }
if (-not (Test-Path -LiteralPath $stopBenchBat)) { throw "stop-kwalify-benchmark.bat not found in $Root" }
if (-not (Test-Path -LiteralPath $stopBat)) { throw "stop-kwalify.bat not found in $Root" }

$reportsDir = Join-Path $Root "reports"
if (-not (Test-Path -LiteralPath $reportsDir)) {
  New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
}

Write-Host ""
New-Shortcut "Start Kwalify" $startBat "Start Kwalify - setup, server, tunnel, open site" ""
if (Test-Path -LiteralPath $adminBat) {
  New-Shortcut "Start Kwalify (Admin)" $adminBat "Start Kwalify with administrator rights (HTTPS/tunnel setup)" ""
} else {
  Write-Host "  skip: start-kwalify-admin.bat not found" -ForegroundColor Yellow
}
New-Shortcut "Stop Kwalify" $stopBat "Stop the server and tunnel" ""
New-Shortcut "Check Beta Ready" $checkBat "Run readiness checklist" ""
New-Shortcut "Open Status Page" $statusBat "Open https://kwalify.net/status" ""
New-Shortcut "Run Benchmark" $benchBat "Benchmark launcher" ""
New-Shortcut "Stop Benchmark" $stopBenchBat "Stop benchmark launcher" ""

Write-Host ""
Write-Host "  Desktop:" -ForegroundColor Magenta
Write-Host "    Start Kwalify   (start.bat - use this)"
Write-Host "    Start Kwalify (Admin)"
Write-Host "    Stop Kwalify"
Write-Host "    Check Beta Ready"
Write-Host "    Open Status Page"
Write-Host "    Run Benchmark"
Write-Host "    Stop Benchmark"
Write-Host ""
