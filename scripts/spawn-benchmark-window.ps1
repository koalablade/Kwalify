# Opens benchmark in a visible PowerShell window (used by web UI + Node API).
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$BenchmarkArgs
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$spawn = Join-Path $PSScriptRoot "spawn-benchmark.ps1"
$reports = Join-Path $Root "reports"
if (-not (Test-Path -LiteralPath $reports)) {
  New-Item -ItemType Directory -Force -Path $reports | Out-Null
}

$log = Join-Path $reports "benchmark-spawn.log"
$label = ($BenchmarkArgs -join " ").Trim()
if (-not $label) { $label = "(no args)" }
Add-Content -LiteralPath $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') UI-SPAWN $label" -Encoding UTF8

$psArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $spawn) + $BenchmarkArgs
$statusPath = Join-Path $reports "benchmark-last-spawn.json"

try {
  $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $psArgs -WorkingDirectory $Root -WindowStyle Normal -PassThru
  if (-not $proc) { throw "Start-Process returned no process." }
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') UI-SPAWN pid=$($proc.Id)" -Encoding UTF8
  @{
    ok = $true
    pid = $proc.Id
    label = $label
    startedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json | ForEach-Object {
    [System.IO.File]::WriteAllText($statusPath, $_, (New-Object System.Text.UTF8Encoding $false))
  }
  exit 0
} catch {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') UI-SPAWN-FAIL $($_.Exception.Message)" -Encoding UTF8
  @{
    ok = $false
    error = $_.Exception.Message
    label = $label
    startedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json | ForEach-Object {
    [System.IO.File]::WriteAllText($statusPath, $_, (New-Object System.Text.UTF8Encoding $false))
  }
  exit 1
}
