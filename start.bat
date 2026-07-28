@echo off
title Start Kwalify
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$banner = Join-Path '%ROOT%' 'scripts\kwalify-banner.txt';" ^
  "$esc = [char]27; $purple = $esc + '[38;2;168;85;247m'; $dim = $esc + '[38;2;192;132;252m'; $reset = $esc + '[0m';" ^
  "if (Test-Path -LiteralPath $banner) { Get-Content -LiteralPath $banner | ForEach-Object { Write-Host ($purple + $_ + $reset) }; Write-Host '' };" ^
  "Write-Host ($dim + '  Double-click this file to run kwalify.net' + $reset); Write-Host ''"

if /I "%~1"=="help" goto :help
if /I "%~1"=="?" goto :help

if /I "%~1"=="setup" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\ensure-kwalify-ready.ps1" -Root "%ROOT%" -SetupOnly
  if errorlevel 1 goto :fail
  echo.
  echo  Setup complete. Double-click start.bat again to launch the server.
  echo.
  pause
  exit /b 0
)

if /I "%~1"=="local" (
  call "%ROOT%\start-kwalify.bat" local %2 %3 %4 %5
  exit /b %ERRORLEVEL%
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\ensure-kwalify-ready.ps1" -Root "%ROOT%"
if errorlevel 1 goto :fail

call "%ROOT%\start-kwalify.bat" selfhost %*
if errorlevel 1 goto :fail

echo.
echo  Done. Keep the Kwalify API and Cloudflare Tunnel windows open.
echo  Press any key to close this launcher...
pause >nul
exit /b 0

:help
echo.
echo  START KWALIFY
echo.
echo    start.bat           Start everything (daily; auto weekly if >7 days)
echo    stop-kwalify.bat    Stop everything
echo    maintain.bat        Weekly check
echo    start.bat setup     First-time setup only
echo    start.bat local     Local dev (no tunnel)
echo.
echo  See START-HERE.txt
pause
exit /b 0

:fail
echo.
echo  Could not start. See messages above.
echo  Log: kwalify-start.log
echo.
pause
exit /b 1
