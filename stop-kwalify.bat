@echo off
title Stop Kwalify
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$banner = Join-Path '%ROOT%' 'scripts\kwalify-banner.txt';" ^
  "$esc = [char]27; $purple = $esc + '[38;2;168;85;247m'; $reset = $esc + '[0m';" ^
  "if (Test-Path -LiteralPath $banner) { Get-Content -LiteralPath $banner | ForEach-Object { Write-Host ($purple + $_ + $reset) }; Write-Host '' }"

set "KWLIFY_PS1=%TEMP%\kwalify-stop-%RANDOM%.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$bat = Get-Content -LiteralPath '%~f0';" ^
  "$s = [array]::IndexOf($bat, ':SCRIPT');" ^
  "$e = [array]::IndexOf($bat, ':ENDSCRIPT');" ^
  "if ($s -lt 0 -or $e -lt 0) { throw 'stop-kwalify.bat is corrupt' };" ^
  "$bat[($s+1)..($e-1)] | Set-Content -LiteralPath '%KWLIFY_PS1%' -Encoding UTF8"
if errorlevel 1 (
  echo Could not prepare stop script.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%KWLIFY_PS1%" -Root "%ROOT%"
set "ERR=%ERRORLEVEL%"
del "%KWLIFY_PS1%" 2>nul

echo.
if not "%ERR%"=="0" (
  echo Stop finished with warnings. See above.
) else (
  echo Kwalify stopped.
)
echo.
pause
exit /b %ERR%

:SCRIPT
param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = "SilentlyContinue"

function Stop-Port([int]$port, [string]$label) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    Write-Host "  $label : not running"
    return
  }
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    try {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      $name = if ($proc) { $proc.ProcessName } else { "pid $procId" }
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "  $label : stopped $name (port $port)"
    } catch {
      Write-Host "  $label : could not stop pid $procId"
    }
  }
}

Write-Host "Stopping Kwalify..." -ForegroundColor Cyan
Write-Host ""

Stop-Port 5000 "API server"
Stop-Port 443 "HTTPS proxy"

$tunnelPid = Join-Path $Root "reports\.cloudflared.pid"
if (Test-Path $tunnelPid) {
  $pidVal = Get-Content $tunnelPid -ErrorAction SilentlyContinue
  if ($pidVal) {
    Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
    Write-Host "  Cloudflare tunnel : stopped (PID $pidVal)"
  }
  Remove-Item $tunnelPid -Force -ErrorAction SilentlyContinue
}

Get-Process -Name cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  Write-Host "  cloudflared : stopped (PID $($_.Id))"
}

$lock = Join-Path $env:TEMP "kwalify-launcher.lock"
if (Test-Path $lock) {
  Remove-Item $lock -Force
  Write-Host "  Launcher lock : cleared"
}

Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowTitle -eq "Kwalify API"
} | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  Write-Host "  Kwalify API window : closed"
}

Write-Host ""
exit 0
:ENDSCRIPT
