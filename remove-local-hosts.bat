@echo off
REM Hosts cleanup is automatic when you run start.bat
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\remove-kwalify-hosts.ps1"
pause
