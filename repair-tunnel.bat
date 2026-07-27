@echo off
REM Tunnel repair is handled by Health Watch. Manual fix only if needed.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-cloudflare-tunnel.ps1" -Root "%~dp0"
pause
