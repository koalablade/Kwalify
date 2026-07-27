@echo off
title Kwalify Weekly Maintenance
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\weekly-maintenance.ps1" -Root "%~dp0"
echo.
pause
