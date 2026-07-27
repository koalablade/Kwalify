@echo off
title Stop Kwalify
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$banner = Join-Path '%ROOT%' 'scripts\kwalify-banner.txt';" ^
  "$esc = [char]27; $purple = $esc + '[38;2;168;85;247m'; $reset = $esc + '[0m';" ^
  "if (Test-Path -LiteralPath $banner) { Get-Content -LiteralPath $banner | ForEach-Object { Write-Host ($purple + $_ + $reset) }; Write-Host '' }"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\stop-kwalify-core.ps1" -Root "%ROOT%"
set "ERR=%ERRORLEVEL%"

echo.
if not "%ERR%"=="0" (
  echo Stop finished with warnings. See above.
) else (
  echo Kwalify stopped.
)
echo.
pause
exit /b %ERR%
