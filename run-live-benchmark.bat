@echo off
title Kwalify Live Benchmark
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-live-benchmark.ps1" -Suite 6h %*
echo.
echo Reports: reports\playlist-evaluation\live-6h\
pause
