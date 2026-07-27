@echo off
title Kwalify Production Readiness
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-production-ready.ps1" -Root "%~dp0"
echo.
pause
exit /b %ERRORLEVEL%
