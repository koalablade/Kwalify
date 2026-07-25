@echo off
REM Redirect -> single benchmark launcher
cd /d "%~dp0"
call "%~dp0start-kwalify-benchmark.bat" large resume %*
