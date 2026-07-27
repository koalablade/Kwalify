# Desktop shortcuts — only the 3 files you need daily.
param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$icon = Join-Path $Root "frontend\public\favicon.svg"

function New-Shortcut([string]$name, [string]$target, [string]$comment) {
  $lnk = Join-Path $desktop "$name.lnk"
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $target
  $sc.WorkingDirectory = $Root
  $sc.WindowStyle = 1
  $sc.Description = $comment
  if (Test-Path -LiteralPath $icon) { $sc.IconLocation = "$icon,0" }
  $sc.Save()
  Write-Host "  OK: $name" -ForegroundColor Green
}

$removeNames = @(
  "Start Kwalify", "Start Kwalify (Beta)", "Start Kwalify (solo dev)",
  "Stop Kwalify", "Stop Benchmark", "Run Benchmark", "Start Benchmark",
  "Check Beta Ready", "Open Status Page", "Weekly Maintenance", "Health Watch",
  "Repair Tunnel", "Maintain Kwalify",
  "1 - Cloudflare Login (once)", "2 - Open Firewall (once, Admin)",
  "3 - Start Kwalify Beta", "Finish Cloudflare Setup",
  "Kwalify Benchmark", "Kwalify Large Benchmark", "Kwalify Benchmark Status",
  "Kwalify Benchmark Smoke", "Package Benchmark Results", "Run Kwalify Benchmark",
  "Benchmark Kwalify", "Kwalify benchmark", "Start Kwalify (Admin)",
  "Quick Check", "Benchmark Results", "Fix Cloudflare DNS"
)

Write-Host ""
Write-Host "  Refreshing Desktop shortcuts (3 files)..." -ForegroundColor Cyan
foreach ($name in $removeNames) {
  $lnk = Join-Path $desktop "$name.lnk"
  if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }
}

$startBat = Join-Path $Root "start.bat"
$stopBat = Join-Path $Root "stop-kwalify.bat"
$maintainBat = Join-Path $Root "maintain.bat"
if (-not (Test-Path -LiteralPath $startBat)) { $startBat = Join-Path $Root "start-kwalify.bat" }
foreach ($f in @($startBat, $stopBat, $maintainBat)) {
  if (-not (Test-Path -LiteralPath $f)) { throw "Missing required file: $f" }
}

Write-Host ""
New-Shortcut "Start Kwalify" $startBat "Start site + tunnel + health watch"
New-Shortcut "Stop Kwalify" $stopBat "Stop API, tunnel, and health watch"
New-Shortcut "Maintain Kwalify" $maintainBat "Weekly readiness + backup check"

Write-Host ""
Write-Host "  Desktop (only 3 shortcuts):" -ForegroundColor Magenta
Write-Host "    Start Kwalify"
Write-Host "    Stop Kwalify"
Write-Host "    Maintain Kwalify"
Write-Host ""
Write-Host "  See START-HERE.txt in the project folder."
Write-Host ""
