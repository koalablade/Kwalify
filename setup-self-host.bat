@echo off
REM ONE-TIME self-host setup: .env for kwalify.net, cloudflared install, Cloudflare login,
REM tunnel config. Afterwards start Kwalify with KWALIFY-START.bat.
title Kwalify self-host setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-kwalify-ready.ps1" -Root "%~dp0." -SetupOnly
if errorlevel 1 (
  echo.
  echo  Setup did not finish. See messages above.
  pause
  exit /b 1
)
echo.
echo  Setup complete. Start Kwalify with KWALIFY-START.bat.
echo.
pause
exit /b 0
