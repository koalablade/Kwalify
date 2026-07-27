@echo off
REM Launches cloudflared in a detached minimized window (reliable on Windows).
set "CF=%~1"
set "CFG=%~2"
if not exist "%CF%" exit /b 1
if not exist "%CFG%" exit /b 2
start "Cloudflare Tunnel" /MIN "%CF%" tunnel --config "%CFG%" run
exit /b 0
