@echo off
REM Redirect -> single benchmark launcher (large preset)
cd /d "%~dp0"
call "%~dp0start-kwalify-benchmark.bat" large %*
