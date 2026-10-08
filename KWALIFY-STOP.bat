@echo off
rem STOP Kwalify gracefully, plus the Cloudflare tunnel if KWALIFY-START started it.
rem Does not stop PostgreSQL or any other program.
title Stop Kwalify
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\kwalify-local.ps1" -Action stop
echo.
pause
