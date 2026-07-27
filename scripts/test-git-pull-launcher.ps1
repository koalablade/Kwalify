# Regression: git pull stderr must not terminate start-kwalify-core (ErrorAction Stop).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "SKIP: git not installed"
  exit 0
}
Push-Location $Root
try {
  $prevErr = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $null = & git pull --ff-only 2>&1
  $pullExit = $LASTEXITCODE
  $ErrorActionPreference = $prevErr
  Write-Host "git pull under Stop launcher: exit=$pullExit (no throw)"
} finally {
  Pop-Location
}
