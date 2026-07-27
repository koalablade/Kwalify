@echo off
title Repair Cloudflare Tunnel
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-cloudflare-tunnel.ps1" -Root "%~dp0"
echo.
pause
