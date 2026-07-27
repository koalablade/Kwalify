@echo off
title Kwalify Beta Check
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-beta-ready.ps1"
echo.
pause
