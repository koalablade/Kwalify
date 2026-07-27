@echo off
title Stop Benchmark
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\stop-benchmark.ps1" -Root "%ROOT%"
set "ERR=%ERRORLEVEL%"

echo.
if not "%ERR%"=="0" (
  echo Stop benchmark finished with warnings. See above.
) else (
  echo Benchmark stopped.
)
echo.
pause
exit /b %ERR%
