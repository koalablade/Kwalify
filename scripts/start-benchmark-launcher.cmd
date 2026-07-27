@echo off
REM Legacy helper — opens benchmark on the main site (no port 5055).
cd /d "%~dp0.."
set "ROOT=%~dp0.."
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\ensure-benchmark-launcher.ps1" -Root "%ROOT%" -OpenBrowser
exit /b %ERRORLEVEL%
