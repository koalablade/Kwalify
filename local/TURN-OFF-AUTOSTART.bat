@echo off
rem One-time cleanup: removes Kwalify scheduled tasks / startup shortcuts / watchdog
rem so nothing Kwalify runs unless you double-click START.bat. Does not touch PostgreSQL.
title Turn off Kwalify auto-start
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\turn-off-kwalify-autostart.ps1"
echo.
pause
