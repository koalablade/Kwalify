@echo off

title Kwalify - Cloudflare Login

cd /d "%~dp0"



set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"

if not exist "%CF%" set "CF=C:\Program Files\cloudflared\cloudflared.exe"



echo.

echo  ============================================================

echo   CLOUDFLARE TUNNEL SETUP

echo  ============================================================

echo.



if not exist "%USERPROFILE%\.cloudflared" mkdir "%USERPROFILE%\.cloudflared"



if exist "%USERPROFILE%\.cloudflared\cert.pem" (

  echo  Cloudflare login already done - skipping to tunnel creation.

  echo.

  goto :create_tunnel

)



echo  Step 1: A browser window will open.

echo  Step 2: CLICK the kwalify.net row on the authorize page.

echo  Step 3: Wait for success in the browser before closing it.

echo.

pause



echo.

echo  Opening Cloudflare login...

"%CF%" tunnel login

if errorlevel 1 (

  echo.

  echo  Login failed. Click kwalify.net on the authorize page, then run again.

  pause

  exit /b 1

)



if not exist "%USERPROFILE%\.cloudflared\cert.pem" (

  echo.

  echo  cert.pem was not created. Click kwalify.net on the authorize page.

  pause

  exit /b 1

)



echo.

echo  Login OK.



:create_tunnel

echo.

echo  Creating tunnel and DNS...

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-cloudflare-tunnel.ps1" -Root "%~dp0" -Hostname "kwalify.net"

if errorlevel 1 (

  echo Tunnel setup failed.

  pause

  exit /b 1

)



if not exist "%~dp0deploy\cloudflared.yml" (

  echo.

  echo  deploy\cloudflared.yml was not created.

  pause

  exit /b 1

)



echo.

echo  Done. Run: Start Kwalify

echo.

pause

