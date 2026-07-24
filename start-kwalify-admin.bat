@echo off
title Start Kwalify (Admin)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','\"%~dp0start-kwalify.bat\"','%*' -WorkingDirectory '%~dp0' -Verb RunAs"
