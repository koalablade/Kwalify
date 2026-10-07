@echo off
rem Gracefully stop the local Kwalify server started by KWALIFY-START.bat.
rem Does not stop PostgreSQL or any other program.
title Stop Kwalify
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\kwalify-local.ps1" -Action stop
echo.
pause
