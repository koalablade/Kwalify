# Keep legacy http://127.0.0.1:5055/ bookmarks working (redirect to main-site /benchmark).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [int]$Port = 5055
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) { return }

$server = Join-Path $Root "scripts\benchmark-launcher-server.ps1"
if (-not (Test-Path -LiteralPath $server)) { return }

Start-Process powershell.exe -ArgumentList @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $server,
  "-Root", $Root, "-Port", $Port, "-NoBrowser"
) -WorkingDirectory $Root -WindowStyle Minimized | Out-Null
