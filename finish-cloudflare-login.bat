@echo off
REM Cloudflare login is now part of start.bat (automatic on first run)
cd /d "%~dp0"
call "%~dp0start.bat" setup %*
