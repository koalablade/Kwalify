@echo off
REM Use start.bat - one file does setup + server + tunnel
cd /d "%~dp0"
call "%~dp0start.bat" %*
