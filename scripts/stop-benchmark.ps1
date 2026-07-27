# Stop benchmark launcher UI and/or active benchmark runs.
param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [switch]$LauncherOnly,
  [switch]$RunOnly
)

$ErrorActionPreference = "SilentlyContinue"
$Root = (Resolve-Path $Root).Path

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

function Stop-BenchmarkLauncher {
  $pidFile = Join-Path $Root "reports\.benchmark-launcher.pid"
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $pidVal = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
      if ($pidVal -and (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
        Write-Host "  Benchmark launcher : stopped (PID $pidVal)"
      }
    } catch {}
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
  # Port 5055 is a legacy redirect to /benchmark — leave it running.
}

function Stop-BenchmarkRunWindows {
  $titles = @(
    "Kwalify Benchmark RUN",
    "Kwalify Benchmark"
  )
  Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -in $titles
  } | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Host "  $($_.MainWindowTitle) : closed (PID $($_.Id))"
  }

  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match 'spawn-benchmark|run-kwalify-benchmark|benchmark:human-keep-live'
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "  benchmark process : stopped (PID $($_.ProcessId))"
  }
}

function Clear-BenchmarkLock {
  $lock = Join-Path $env:TEMP "kwalify-benchmark.lock"
  if (-not (Test-Path -LiteralPath $lock)) { return }
  try {
    $fs = [System.IO.File]::Open($lock, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $fs.Dispose()
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
    Write-Host "  Benchmark lock : cleared (idle)"
  } catch {
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
    Write-Host "  Benchmark lock : cleared (was held)"
  }
}

Write-Host "Stopping benchmark..." -ForegroundColor Cyan
Write-Host ""

if (-not $RunOnly) { Stop-BenchmarkLauncher }
if (-not $LauncherOnly) {
  Stop-BenchmarkRunWindows
  Clear-BenchmarkLock
}

Write-Host ""
exit 0
