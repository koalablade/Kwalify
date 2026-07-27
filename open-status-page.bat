@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; try { $r=Invoke-RestMethod 'http://127.0.0.1:5000/api/readyz' -TimeoutSec 2; $ok=($r.status -eq 'ready' -or $r.readiness -eq 'ready') } catch {}; if ($ok) { Start-Process 'http://127.0.0.1:5000/status' } else { Start-Process 'https://kwalify.net/status' }"
