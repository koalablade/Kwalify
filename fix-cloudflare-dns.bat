@echo off
REM Manual fix: points the Cloudflare DNS record for kwalify.net at this tunnel.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\fix-cloudflare-dns.ps1" -Root "%~dp0"
pause
