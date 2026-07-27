@echo off
title Kwalify Health Watch
cd /d "%~dp0"
echo.
echo  Keeps tunnel healthy while Kwalify is running.
echo  Checks every 5 minutes. Close this window to stop.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\watch-local-health.ps1" -Root "%~dp0"
pause
