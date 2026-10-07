@echo off
rem START Kwalify. Opens a "Kwalify server" window that shows checks and server logs.
rem Stop it with STOP.bat (in this folder) or Ctrl+C in that window.
start "Kwalify server" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0..\scripts\kwalify-local.ps1" -Action start
