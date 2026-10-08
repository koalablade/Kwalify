@echo off
rem START Kwalify. Opens a "Kwalify server" window that shows checks and server logs.
rem On a PC set up for self-hosting it also starts the Cloudflare tunnel (kwalify.net).
rem   KWALIFY-START.bat         normal start
rem   KWALIFY-START.bat local   this PC only (no Cloudflare tunnel)
rem Stop it with KWALIFY-STOP.bat or Ctrl+C in the server window.
set "KW_ARGS="
if /I "%~1"=="local" set "KW_ARGS=-NoTunnel"
start "Kwalify server" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0scripts\kwalify-local.ps1" -Action start %KW_ARGS%
