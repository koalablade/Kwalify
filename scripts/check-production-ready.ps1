# Full self-host production readiness report (automated checks + manual reminders).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path $Root).Path
$envPath = Join-Path $Root ".env"
$fail = 0

Write-Host ""
Write-Host "  KWALIFY SELF-HOST PRODUCTION READINESS" -ForegroundColor Magenta
Write-Host "  ======================================" -ForegroundColor Magenta
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check-beta-ready.ps1") -Root $Root
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check-uptime.ps1") -Root $Root
$uptimeExit = $LASTEXITCODE
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\check-windows-host.ps1") -Root $Root
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\verify-backup.ps1") -Root $Root
$backupExit = $LASTEXITCODE
Write-Host ""

Write-Host "  PRODUCTION MARKERS" -ForegroundColor Cyan
$restoreMarker = Join-Path $Root "reports\.backup-restore-verified"
$uptimeMarker = Join-Path $Root "reports\.external-uptime-configured"
$secretsMarker = Join-Path $Root "reports\.secrets-backed-up"
$phoneMarker = Join-Path $Root "reports\.phone-test-verified"

if (Test-Path -LiteralPath $restoreMarker) {
  Write-Host "  [OK]   Backup restore verified ($((Get-Content -LiteralPath $restoreMarker -Raw).Trim()))" -ForegroundColor Green
} else {
  Write-Host "  [!!]   Backup restore not verified - npm run maintenance:test-restore" -ForegroundColor Red
  $fail++
}
if (Test-Path -LiteralPath $uptimeMarker) {
  Write-Host "  [OK]   External uptime monitor ($((Get-Content -LiteralPath $uptimeMarker -Raw).Trim()))" -ForegroundColor Green
} else {
  Write-Host "  [!!]   External uptime not marked - see docs\UPTIME-MONITORING.md" -ForegroundColor Red
  $fail++
}
if (Test-Path -LiteralPath $secretsMarker) {
  Write-Host "  [OK]   Secrets backed up offline ($((Get-Content -LiteralPath $secretsMarker -Raw).Trim()))" -ForegroundColor Green
} else {
  Write-Host "  [?]    Secrets backup not marked - run scripts\mark-secrets-backed-up.ps1 after saving .env" -ForegroundColor Yellow
}
if (Test-Path -LiteralPath $phoneMarker) {
  $phoneWhen = (Get-Content -LiteralPath $phoneMarker -Raw).Trim()
  $phoneDate = if ($phoneWhen -match '^(\d{4}-\d{2}-\d{2})') { $Matches[1] } else { "" }
  $phoneAgeDays = if ($phoneDate) { ((Get-Date) - [datetime]$phoneDate).TotalDays } else { 999 }
  if ($phoneAgeDays -le 7) {
    Write-Host "  [OK]   Phone test this week ($phoneWhen)" -ForegroundColor Green
  } else {
    Write-Host "  [?]    Phone test stale ($phoneWhen) - run scripts\mark-phone-test.ps1 after mobile test" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [?]    Phone test not logged - run scripts\mark-phone-test.ps1 after mobile test" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  CAPACITY & MONITORING" -ForegroundColor Cyan
if (Test-Path -LiteralPath $envPath) {
  $workers = (Select-String -Path $envPath -Pattern '^\s*V3_PARALLEL_WORKERS=' | Select-Object -First 1)
  $conc = (Select-String -Path $envPath -Pattern '^\s*GENERATE_CONCURRENCY_LIMIT=' | Select-Object -First 1)
  $selfHost = Select-String -Path $envPath -Pattern '^\s*KWALIFY_HOST_MODE=selfhost' -Quiet
  if ($workers) { Write-Host "  [OK]   $((($workers.Line -replace '^\s*','').Trim()))" -ForegroundColor Green }
  elseif ($selfHost) { Write-Host "  [!!]   V3_PARALLEL_WORKERS not set (recommended: 4)" -ForegroundColor Red; $fail++ }
  else { Write-Host "  [?]    V3_PARALLEL_WORKERS not set (recommended: 4)" -ForegroundColor Yellow }
  if ($conc) { Write-Host "  [OK]   $((($conc.Line -replace '^\s*','').Trim()))" -ForegroundColor Green }
  elseif ($selfHost) { Write-Host "  [!!]   GENERATE_CONCURRENCY_LIMIT not set (recommended: 2)" -ForegroundColor Red; $fail++ }
  else { Write-Host "  [?]    GENERATE_CONCURRENCY_LIMIT not set (recommended: 2)" -ForegroundColor Yellow }
  if (Select-String -Path $envPath -Pattern '^\s*SENTRY_DSN=https?://' -Quiet) {
    Write-Host "  [OK]   SENTRY_DSN configured (restart API after changes)" -ForegroundColor Green
  } else {
    Write-Host "  [?]    SENTRY_DSN not set (optional - sentry.io free tier)" -ForegroundColor Yellow
  }
  if ($selfHost) {
    $contractOk = @(
      "PLAYLIST_CONTRACT_WORLD_GATE",
      "PLAYLIST_CONTRACT_V40",
      "PLAYLIST_CONTRACT_V41"
    ) | ForEach-Object {
      $m = Select-String -Path $envPath -Pattern "^\s*$_=\s*(1|true|on|shadow)\s*$" -Quiet
      if (-not $m) { $_ }
    }
    if ($contractOk.Count -eq 0) {
      Write-Host "  [OK]   PLAYLIST_CONTRACT_WORLD_GATE/V40/V41 enabled (compound-intent path)" -ForegroundColor Green
    } else {
      Write-Host "  [!!]   Compound-intent flags off: $($contractOk -join ', ') — set to 1 or restart via start.bat" -ForegroundColor Red
      $fail++
    }
  }
}

Write-Host ""
Write-Host "  EXTERNAL GATES (manual)" -ForegroundColor Cyan
Write-Host "  -------------------------------------------"
@(
  "Spotify Extended Quota / app review (after happy testers)",
  "Spotify allowlist full (5/5 done if testers can log in)",
  "Real usage from testers (watch kwalify-api.log / Sentry)"
) | ForEach-Object {
  Write-Host "  [ ] $_" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Full guide: docs\SELF-HOST-PRODUCTION.md"
Write-Host ""

if ($uptimeExit -ne 0 -or $backupExit -ne 0 -or $fail -gt 0) {
  Write-Host "  Fix [!!] items above before calling production-ready." -ForegroundColor Yellow
  exit 1
}
Write-Host "  Self-host production checks passed." -ForegroundColor Green
exit 0
