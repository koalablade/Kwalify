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
echo    nobuild  Skip rebuild when dist already exists
echo    build    Force npm run build before start
echo.

set "EXTRA="
if /I "%~1"=="http" set "EXTRA=-HttpOnly"
if /I "%~1"=="nobuild" set "EXTRA=-SkipBuild"
if /I "%~1"=="build" set "EXTRA=-Build"
if /I "%~2"=="http" set "EXTRA=%EXTRA% -HttpOnly"
if /I "%~2"=="nobuild" set "EXTRA=%EXTRA% -SkipBuild"
if /I "%~2"=="build" set "EXTRA=%EXTRA% -Build"
if /I "%~3"=="http" set "EXTRA=%EXTRA% -HttpOnly"
if /I "%~3"=="nobuild" set "EXTRA=%EXTRA% -SkipBuild"
if /I "%~3"=="build" set "EXTRA=%EXTRA% -Build"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-kwalify-local.ps1" %EXTRA%
if errorlevel 1 (
  echo.
  echo Startup failed. See messages above.
  pause
  exit /b 1
)
echo.
echo Launcher finished. If you used http mode, the site runs in the "Kwalify API" window.
echo Press any key to close this launcher (server keeps running)...
pause >nul
