@echo off
REM Removes a "127.0.0.1 kwalify.net" hosts line (left by the old local-domain mode).
REM Right-click > Run as administrator.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\remove-kwalify-hosts.ps1"
pause
