@echo off
title Kwalify Beta Server
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$esc = [char]27; $purple = $esc + '[38;2;168;85;247m'; $dim = $esc + '[38;2;192;132;252m'; $reset = $esc + '[0m';" ^
  "Write-Host ''; Write-Host ($purple + '  KWALIFY BETA SERVER' + $reset);" ^
  "Write-Host ($dim + '  kwalify.net via Cloudflare Tunnel' + $reset); Write-Host ''"

call "%~dp0start-kwalify.bat" selfhost %*
