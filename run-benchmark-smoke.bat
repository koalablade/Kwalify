@echo off
title Kwalify Benchmark Smoke Test
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-live-benchmark.ps1" -Suite smoke
pause
