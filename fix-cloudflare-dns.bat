@echo off
REM DNS fix is automatic when you run start.bat
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\fix-cloudflare-dns.ps1" -Root "%~dp0"
pause
