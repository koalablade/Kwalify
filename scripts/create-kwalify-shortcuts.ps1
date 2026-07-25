# Desktop shortcuts - keeps ONLY what you need. Removes all old duplicates.
param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

$startBat = Join-Path $Root "start-kwalify.bat"
$stopBat = Join-Path $Root "stop-kwalify.bat"
$benchBat = Join-Path $Root "start-kwalify-benchmark.bat"
if (-not (Test-Path -LiteralPath $startBat)) { throw "start-kwalify.bat not found in $Root" }
if (-not (Test-Path -LiteralPath $stopBat)) { throw "stop-kwalify.bat not found in $Root" }
if (-not (Test-Path -LiteralPath $benchBat)) { throw "start-kwalify-benchmark.bat not found in $Root" }

$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$icon = Join-Path $Root "frontend\public\favicon.ico"

# Every old name we ever created - remove so Desktop stays clean
$removeNames = @(
  "Kwalify Benchmark",
  "Kwalify Large Benchmark",
  "Kwalify Benchmark Status",
  "Kwalify Benchmark Smoke",
  "Package Benchmark Results",
  "Run Kwalify Benchmark",
  "Benchmark Kwalify",
  "Kwalify benchmark",
  "Start Kwalify (Admin)",
  "Quick Check",
  "Benchmark Results"
)

function New-Shortcut([string]$name, [string]$target, [string]$comment, [string]$args = "") {
  $lnk = Join-Path $desktop "$name.lnk"
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $target
  $sc.WorkingDirectory = $Root
  $sc.WindowStyle = 1
  $sc.Description = $comment
  if ($args) { $sc.Arguments = $args }
  if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
  $sc.Save()
  Write-Host "  OK: $name" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Cleaning Desktop..." -ForegroundColor Cyan
foreach ($name in $removeNames) {
  $lnk = Join-Path $desktop "$name.lnk"
  if (Test-Path -LiteralPath $lnk) {
    Remove-Item -LiteralPath $lnk -Force
    Write-Host "  Removed: $name"
  }
}

$reportsDir = Join-Path $Root "reports"
if (-not (Test-Path -LiteralPath $reportsDir)) { New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null }

Write-Host ""
Write-Host "  Creating shortcuts (only these 3):" -ForegroundColor Cyan
New-Shortcut "Start Kwalify" $startBat "Step 1 - start the app (do this first)"
New-Shortcut "Run Benchmark" $benchBat "Benchmark launcher - buttons + chat" ""
New-Shortcut "Stop Kwalify" $stopBat "Stop the server"

Write-Host ""
Write-Host "  YOUR DESKTOP NOW HAS:" -ForegroundColor Magenta
Write-Host "    1. Start Kwalify     <- run first"
Write-Host "    2. Run Benchmark     <- launcher (smoke, results, etc. inside)"
Write-Host "    3. Stop Kwalify      <- when done"
Write-Host ""
Write-Host "  Project: $Root" -ForegroundColor DarkGray
