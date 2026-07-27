@echo off
title Kwalify Self-Host Setup
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$banner = Join-Path '%~dp0' 'scripts\kwalify-banner.txt';" ^
  "$esc = [char]27; $purple = $esc + '[38;2;168;85;247m'; $reset = $esc + '[0m';" ^
  "if (Test-Path -LiteralPath $banner) { Get-Content -LiteralPath $banner | ForEach-Object { Write-Host ($purple + $_ + $reset) }; Write-Host '' }"

echo.
echo  One-time setup for closed beta on kwalify.net
echo  Uses Cloudflare Tunnel - no router port forwarding needed.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-self-host.ps1" -PublicUrl "https://kwalify.net" -Exposure cloudflare -Auto
set ERR=%ERRORLEVEL%

echo.
if not "%ERR%"=="0" (
  echo  Setup failed. See messages above.
  echo  Try: right-click this file - Run as administrator
) else (
  echo  All done. Use Desktop shortcut: Start Kwalify ^(Beta^)
)
echo.
pause
exit /b %ERR%
