@echo off
title Kwalify Benchmark
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$esc = [char]27; $purple = $esc + '[38;2;168;85;247m'; $dim = $esc + '[38;2;192;132;252m'; $reset = $esc + '[0m';" ^
  "Write-Host ''; Write-Host ($purple + '  KWALIFY BENCHMARK' + $reset);" ^
  "Write-Host ($dim + '  Opens launcher UI - buttons + chat box' + $reset);" ^
  "Write-Host ($dim + '  KEEP the launcher window open while you use it' + $reset); Write-Host ''"

set "SUITE="
set "LIMIT=0"
set "GROUP="
set "PSARGS="

:parse
if "%~1"=="" goto run
if /I "%~1"=="run" (
  shift
  set "NATURAL=%*"
  set "PSARGS=-Request \"%NATURAL%\""
  goto run
)
if /I "%~1"=="go" (
  set "PSARGS=%PSARGS% -Suite go"
  shift
  goto parse
)
if /I "%~1"=="help" (
  set "PSARGS=-Help"
  shift
  goto parse
)
if /I "%~1"=="?" (
  set "PSARGS=-Help"
  shift
  goto parse
)
if /I "%~1"=="menu" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\run-kwalify-benchmark.ps1"
  set "ERR=%ERRORLEVEL%"
  goto done
)
if /I "%~1"=="spawnlocal" (
  set "PSARGS=%PSARGS% -SpawnLocal"
  shift
  goto parse
)
if /I "%~1"=="resume" (
  set "PSARGS=%PSARGS% -Resume"
  shift
  goto parse
)
if /I "%~1"=="dryrun" (
  set "PSARGS=%PSARGS% -DryRun"
  shift
  goto parse
)
if /I "%~1"=="nobuild" (
  set "PSARGS=%PSARGS% -SkipBuild"
  shift
  goto parse
)
if /I "%~1"=="production" (
  set "PSARGS=%PSARGS% -Production"
  shift
  goto parse
)
if /I "%~1"=="yes" (
  set "PSARGS=%PSARGS% -NoMenu"
  shift
  goto parse
)
if /I "%~1"=="variety" (
  set "PSARGS=%PSARGS% -Variety"
  shift
  goto parse
)
if /I "%~1"=="package" (
  set "PSARGS=%PSARGS% -Package"
  shift
  goto parse
)
if /I "%~1"=="advanced" (
  shift
  goto parse
)
if /I "%~1"=="guide" (
  set "PSARGS=-Suite guide"
  shift
  goto parse
)
if /I "%~1"=="smoke" (
  set "PSARGS=-Suite smoke"
  shift
  goto parse
)
if /I "%~1"=="package" (
  set "PSARGS=-Suite package"
  shift
  goto parse
)
if /I "%~1"=="mix-small" (
  set "PSARGS=%PSARGS% -Suite mix-small"
  shift
  goto parse
)
if /I "%~1"=="mix-medium" (
  set "PSARGS=%PSARGS% -Suite mix-medium"
  shift
  goto parse
)
if /I "%~1"=="mix-long" (
  set "PSARGS=%PSARGS% -Suite mix-long"
  shift
  goto parse
)
if /I "%~1"=="large" (
  set "PSARGS=%PSARGS% -Suite large"
  shift
  goto parse
)
if /I "%~1"=="long" (
  set "PSARGS=%PSARGS% -Suite long"
  shift
  goto parse
)
if /I "%~1"=="full" (
  set "PSARGS=%PSARGS% -Suite long"
  shift
  goto parse
)
if /I "%~1"=="small" (
  set "PSARGS=%PSARGS% -Suite small"
  shift
  goto parse
)
if /I "%~1"=="medium" (
  set "PSARGS=%PSARGS% -Suite medium"
  shift
  goto parse
)
if /I "%~1"=="status" (
  set "PSARGS=-Suite status"
  shift
  goto parse
)
if /I "%~1"=="limit" (
  set "LIMIT=%~2"
  set "PSARGS=%PSARGS% -Limit %~2"
  shift
  shift
  goto parse
)
if /I "%~1"=="group" (
  set "GROUP=%~2"
  set "PSARGS=%PSARGS% -Group ""%~2"""
  shift
  shift
  goto parse
)
if /I "%~1"=="url" (
  set "PSARGS=%PSARGS% -BaseUrl ""%~2"""
  shift
  shift
  goto parse
)
if not defined SUITE (
  set "SUITE=%~1"
  set "PSARGS=%PSARGS% -Suite ""%~1"""
  shift
  goto parse
)
shift
goto parse

:run
if "%PSARGS%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\benchmark-launcher-server.ps1" -Root "%ROOT%"
  exit /b %ERRORLEVEL%
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\run-kwalify-benchmark.ps1" %PSARGS%
set "ERR=%ERRORLEVEL%"

echo.
if not "%ERR%"=="0" (
  echo  Benchmark failed. See kwalify-benchmark.log in the project folder.
  echo  Reports are under reports\
) else (
  echo  Done. Log: kwalify-benchmark.log
  echo  Reports: reports\
)
echo.
pause
exit /b %ERR%

:done
echo.
if not "%ERR%"=="0" (
  echo  Benchmark failed. See kwalify-benchmark.log
) else (
  echo  Done.
)
echo.
pause
exit /b %ERR%
