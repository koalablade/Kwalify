@echo off
title Create Kwalify shortcuts
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\create-kwalify-shortcuts.ps1" -Root "%ROOT%"
if errorlevel 1 (
  echo.
  echo Could not create shortcuts.
  pause
  exit /b 1
)

echo.
echo Desktop shortcuts:
echo   Start Kwalify
echo   Run Benchmark
echo   Stop Kwalify
echo.
pause
exit /b 0
