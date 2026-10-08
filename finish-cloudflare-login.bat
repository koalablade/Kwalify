@echo off
REM One-time Cloudflare login + tunnel setup (same as setup-self-host.bat).
cd /d "%~dp0"
call "%~dp0setup-self-host.bat" %*
