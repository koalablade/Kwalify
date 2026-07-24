@echo off
title Kwalify Local Host
cd /d "%~dp0"

echo.
echo  Kwalify local host
echo  -----------------
echo  Starts: PostgreSQL (if installed) -^> API on :5000 -^> optional https://kwalify.net proxy
echo.
echo  Options (pass to this bat):
echo    http     HTTP only on localhost:5000 (no SSL proxy)
echo    nobuild  Skip forcing a rebuild when dist already exists
echo.

set "EXTRA="
if /I "%~1"=="http" set "EXTRA=-HttpOnly"
if /I "%~1"=="nobuild" set "EXTRA=-SkipBuild"
if /I "%~2"=="http" set "EXTRA=%EXTRA% -HttpOnly"
if /I "%~2"=="nobuild" set "EXTRA=%EXTRA% -SkipBuild"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-kwalify-local.ps1" %EXTRA%
if errorlevel 1 (
  echo.
  echo Startup failed. See messages above.
  pause
  exit /b 1
)
