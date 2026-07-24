# Create Desktop shortcuts for Start / Stop Kwalify.
param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

$startBat = Join-Path $Root "start-kwalify.bat"
$stopBat = Join-Path $Root "stop-kwalify.bat"
if (-not (Test-Path -LiteralPath $startBat)) { throw "start-kwalify.bat not found in $Root" }
if (-not (Test-Path -LiteralPath $stopBat)) { throw "stop-kwalify.bat not found in $Root" }

$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell

function New-Shortcut([string]$name, [string]$target, [string]$iconPath, [string]$comment) {
  $lnk = Join-Path $desktop "$name.lnk"
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $target
  $sc.WorkingDirectory = $Root
  $sc.WindowStyle = 1
  $sc.Description = $comment
  if (Test-Path $iconPath) { $sc.IconLocation = "$iconPath,0" }
  $sc.Save()
  Write-Host "  Created: $lnk"
}

$icon = Join-Path $Root "frontend\public\favicon.ico"
New-Shortcut "Start Kwalify" $startBat $icon "Start Kwalify local server (https://kwalify.net)"
New-Shortcut "Stop Kwalify" $stopBat $icon "Stop Kwalify API and HTTPS proxy"
$adminBat = Join-Path $Root "start-kwalify-admin.bat"
if (Test-Path -LiteralPath $adminBat) {
  New-Shortcut "Start Kwalify (Admin)" $adminBat $icon "Start Kwalify as Administrator (port 443 HTTPS)"
}

Write-Host ""
Write-Host "Shortcuts always point at:" -ForegroundColor Green
Write-Host "  $Root"
