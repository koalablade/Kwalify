@echo off
title Kwalify
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$banner = Join-Path '%ROOT%' 'scripts\kwalify-banner.txt';" ^
  "$esc = [char]27; $purple = $esc + '[38;2;168;85;247m'; $dim = $esc + '[38;2;192;132;252m'; $reset = $esc + '[0m';" ^
  "if (Test-Path -LiteralPath $banner) { Get-Content -LiteralPath $banner | ForEach-Object { Write-Host ($purple + $_ + $reset) }; Write-Host ($dim + '  local dev launcher' + $reset); Write-Host '' }"

set "MODE=domain"
if /I "%~1"=="local" set "MODE=local"
if /I "%~2"=="local" set "MODE=local"
if /I "%~1"=="selfhost" set "MODE=selfhost"
if /I "%~2"=="selfhost" set "MODE=selfhost"
if /I "%~1"=="build" set "BUILD=1"
if /I "%~2"=="build" set "BUILD=1"
if /I "%~1"=="nopull" set "NOPULL=1"
if /I "%~2"=="nopull" set "NOPULL=1"
if /I "%~1"=="quick" set "QUICK=1"
if /I "%~2"=="quick" set "QUICK=1"
if /I "%~1"=="nowatch" set "NOWATCH=1"
if /I "%~2"=="nowatch" set "NOWATCH=1"

set "ARGS="
if defined BUILD set "ARGS=-Build"
if defined NOPULL set "ARGS=%ARGS% -NoPull"
if defined QUICK set "ARGS=%ARGS% -Quick"
if defined NOWATCH set "ARGS=%ARGS% -NoWatch"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\start-kwalify-core.ps1" -Root "%ROOT%" -Mode "%MODE%" %ARGS%
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
  echo.
  echo  Could not start. See kwalify-start.log in the project folder.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$help = Join-Path '%ROOT%' 'frontend\public\local-start-help.html';" ^
    "if (Test-Path -LiteralPath $help) { Start-Process $help }"
  echo.
  pause
  exit /b %ERR%
)

echo.
echo  Running in the "Kwalify API" window. Close that to stop.
echo  Press any key to close this launcher...
pause >nul
exit /b 0
