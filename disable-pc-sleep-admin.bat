@echo off
title Kwalify - Disable PC Sleep (Admin)
cd /d "%~dp0"
echo.
echo  Disables sleep on AC power so Kwalify stays online.
echo  Admin prompt will appear - click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0scripts\disable-pc-sleep.ps1\"\"' -Wait"
echo.
pause
