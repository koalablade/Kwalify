@echo off

title Remove kwalify.net hosts override

cd /d "%~dp0"

echo.

echo  Removes 127.0.0.1 kwalify.net from hosts so Cloudflare tunnel works on this PC.

echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\remove-kwalify-hosts.ps1"

echo.

pause

