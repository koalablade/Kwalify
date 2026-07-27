@echo off
REM Health watch starts automatically with start.bat. Use this only to run it alone.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\watch-local-health.ps1" -Root "%~dp0"
pause
