@echo off
title Kwalify - UptimeRobot Setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-uptime-setup.ps1"
echo.
pause
