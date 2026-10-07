@echo off
rem Start the local Kwalify server. Stop it with KWALIFY-STOP.bat.
rem Opens a "Kwalify server" window that shows startup checks and server logs.
cd /d "%~dp0"
start "Kwalify server" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0scripts\kwalify-local.ps1" -Action start
