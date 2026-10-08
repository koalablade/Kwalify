@echo off
rem ONE-TIME cleanup of the old Kwalify launchers: removes Kwalify scheduled tasks,
rem Startup-folder entries, the health-watch watchdog and Desktop shortcuts that point
rem at launcher files that no longer exist. After this, Kwalify only runs when you
rem double-click KWALIFY-START.bat. Does not touch PostgreSQL or your data.
title Turn off Kwalify auto-start
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\turn-off-kwalify-autostart.ps1"
echo.
pause
