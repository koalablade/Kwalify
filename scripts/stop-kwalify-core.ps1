param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = "SilentlyContinue"

function Stop-Port([int]$port, [string]$label) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    Write-Host "  $label : not running"
    return
  }
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    try {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      $name = if ($proc) { $proc.ProcessName } else { "pid $procId" }
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "  $label : stopped $name (port $port)"
    } catch {
      Write-Host "  $label : could not stop pid $procId"
    }
  }
}

Write-Host "Stopping Kwalify..." -ForegroundColor Cyan
Write-Host ""

Stop-Port 5000 "API server"
Stop-Port 443 "HTTPS proxy"
Stop-Port 5055 "Benchmark redirect"

$tunnelPid = Join-Path $Root "reports\.cloudflared.pid"
if (Test-Path $tunnelPid) {
  $pidVal = Get-Content $tunnelPid -ErrorAction SilentlyContinue
  if ($pidVal) {
    Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
    Write-Host "  Cloudflare tunnel : stopped (PID $pidVal)"
  }
  Remove-Item $tunnelPid -Force -ErrorAction SilentlyContinue
}

Get-Process -Name cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  Write-Host "  cloudflared : stopped (PID $($_.Id))"
}

$watchPidFile = Join-Path $Root "reports\.kwalify-watchdog.pid"
if (Test-Path -LiteralPath $watchPidFile) {
  $watchPid = (Get-Content -LiteralPath $watchPidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($watchPid) {
    Stop-Process -Id $watchPid -Force -ErrorAction SilentlyContinue
    Write-Host "  Health watch : stopped (PID $watchPid)"
  }
  Remove-Item -LiteralPath $watchPidFile -Force -ErrorAction SilentlyContinue
}

Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowTitle -eq "Kwalify Health Watch"
} | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  Write-Host "  Health watch window : closed"
}

$lock = Join-Path $env:TEMP "kwalify-launcher.lock"
if (Test-Path $lock) {
  Remove-Item $lock -Force
  Write-Host "  Launcher lock : cleared"
}

Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowTitle -eq "Kwalify API"
} | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  Write-Host "  Kwalify API window : closed"
}

$stopBench = Join-Path $Root "scripts\stop-benchmark.ps1"
if (Test-Path -LiteralPath $stopBench) {
  & $stopBench -Root $Root | Out-Null
}

Write-Host ""
exit 0
