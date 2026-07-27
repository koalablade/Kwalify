@echo off
title Kwalify - Open Firewall (Admin)
cd /d "%~dp0"
echo.
echo  Opens Windows Firewall for ports 5000 and 443.
echo  Admin prompt will appear - click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0scripts\open-firewall.ps1\"\"' -Wait"
echo.
echo  Done. You can close this window.
pause
