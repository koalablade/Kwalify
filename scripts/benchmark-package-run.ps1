# Package latest benchmark run to Desktop zip (logs + reports + STATUS).
param(
  [string]$RunId = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\benchmark-lib.ps1" -Root $root

Write-Host ""
Write-Host "  Packaging benchmark run..." -ForegroundColor Cyan
try {
  $zip = Package-BenchmarkRun -RunId $RunId
  Write-Host ""
  Write-Host "  Created:" -ForegroundColor Green
  Write-Host "  $zip"
  Write-Host ""
  Write-Host "  Attach this zip when sharing results (Discord, email, Cursor)."
  Start-Process explorer.exe "/select,$zip" | Out-Null
} catch {
  Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  Run a benchmark first, or pass a run ID."
  exit 1
}
