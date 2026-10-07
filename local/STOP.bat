@echo off
rem STOP Kwalify gracefully. Does not stop PostgreSQL or any other program.
title Stop Kwalify
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\kwalify-local.ps1" -Action stop
echo.
pause
