@echo off
title Kwalify Maintain
cd /d "%~dp0"

echo.
echo  KWALIFY WEEKLY MAINTENANCE
echo  ==========================
echo  Checks: readiness, backups, routes, logs
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\weekly-maintenance.ps1" -Root "%~dp0"
set "ERR=%ERRORLEVEL%"

echo.
if "%ERR%"=="0" (
  echo  Maintenance complete.
) else (
  echo  Maintenance finished with warnings — read messages above.
)
echo.
pause
exit /b %ERR%
