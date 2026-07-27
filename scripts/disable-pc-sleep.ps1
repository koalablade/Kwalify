# Disable sleep/hibernate on AC power (recommended for 24/7 self-host).
param(
  [switch]$AlsoOnBattery
)

$ErrorActionPreference = "Stop"

function Set-PowerTimeout([string]$setting, [int]$secondsAc, [int]$secondsDc) {
  powercfg /change $setting $secondsAc | Out-Null
  if ($AlsoOnBattery) {
    powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP STANDBYIDLE $secondsAc | Out-Null
    powercfg /SETDCVALUEINDEX SCHEME_CURRENT SUB_SLEEP STANDBYIDLE $secondsDc | Out-Null
    powercfg /SETACTIVE SCHEME_CURRENT | Out-Null
  }
}

Write-Host ""
Write-Host "  DISABLE PC SLEEP (AC power)" -ForegroundColor Magenta

try {
  Set-PowerTimeout "standby-timeout-ac" 0 0
  Set-PowerTimeout "hibernate-timeout-ac" 0 0
  Set-PowerTimeout "monitor-timeout-ac" 0 0
  if ($AlsoOnBattery) {
    powercfg /SETDCVALUEINDEX SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 0 | Out-Null
    powercfg /SETDCVALUEINDEX SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE 0 | Out-Null
    powercfg /SETACTIVE SCHEME_CURRENT | Out-Null
  }
} catch {
  Write-Host "  [!!]   Could not change power plan. Run disable-pc-sleep-admin.bat as Administrator." -ForegroundColor Yellow
  exit 1
}

$sleep = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null | Select-String "Current AC Power Setting Index"
if ($sleep -match "0x00000000") {
  Write-Host "  [OK]   Sleep disabled on AC power" -ForegroundColor Green
} else {
  Write-Host "  [?]    Power plan may still allow sleep - check Settings -> Power" -ForegroundColor Yellow
  exit 1
}

if ($AlsoOnBattery) {
  Write-Host "  [OK]   Sleep also disabled on battery" -ForegroundColor Green
}

Write-Host ""
exit 0
