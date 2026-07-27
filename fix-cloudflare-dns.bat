@echo off

title Fix Cloudflare DNS for kwalify.net

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\fix-cloudflare-dns.ps1"

echo.

pause

