# Quick closed-beta readiness check for kwalify.net
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "SilentlyContinue"
$Root = (Resolve-Path $Root).Path
$ok = 0
$warn = 0
$fail = 0

function Row([string]$label, [bool]$pass, [string]$detail) {
  if ($pass) {
    Write-Host "  [OK]   $label" -ForegroundColor Green
    if ($detail) { Write-Host "         $detail" -ForegroundColor DarkGray }
    $script:ok++
  } else {
    Write-Host "  [!!]   $label" -ForegroundColor Red
    if ($detail) { Write-Host "         $detail" -ForegroundColor Yellow }
    $script:fail++
  }
}

function WarnRow([string]$label, [string]$detail) {
  Write-Host "  [?]    $label" -ForegroundColor Yellow
  if ($detail) { Write-Host "         $detail" -ForegroundColor DarkGray }
  $script:warn++
}

Write-Host ""
Write-Host "  KWALIFY BETA READINESS" -ForegroundColor Magenta
Write-Host ""

# .env
$envPath = Join-Path $Root ".env"
$envOk = $false
$appUrl = ""
if (Test-Path $envPath) {
  $lines = Get-Content $envPath
  $appUrl = ($lines | Where-Object { $_ -match '^APP_URL=' } | Select-Object -First 1) -replace '^APP_URL=', ''
  $mode = ($lines | Where-Object { $_ -match '^KWALIFY_HOST_MODE=' } | Select-Object -First 1) -replace '^KWALIFY_HOST_MODE=', ''
  $nodeEnv = ($lines | Where-Object { $_ -match '^NODE_ENV=' } | Select-Object -First 1) -replace '^NODE_ENV=', ''
  $envOk = ($mode -eq "selfhost" -and $nodeEnv -eq "production" -and $appUrl -like "https://*")
}
Row "Self-host .env configured" $envOk "APP_URL=$appUrl"

# Cloudflare
$cfCert = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"
$tunnelYml = Join-Path $Root "deploy\cloudflared.yml"
Row "Cloudflare account linked" (Test-Path -LiteralPath $cfCert) $(if (-not (Test-Path -LiteralPath $cfCert)) { "Run finish-cloudflare-setup.bat or see FIRST-TIME-SETUP.txt" } else { "cert.pem present" })
Row "Cloudflare tunnel configured" (Test-Path $tunnelYml) $(if (-not (Test-Path $tunnelYml)) { "Run finish-cloudflare-setup.bat (tunnel step)" } else { "deploy\cloudflared.yml" })

$cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
if (-not (Test-Path $cf)) { $cf = "$env:ProgramFiles\cloudflared\cloudflared.exe" }
Row "cloudflared installed" (Test-Path $cf) $cf

# Tunnel running
$tunnelPid = Join-Path $Root "reports\.cloudflared.pid"
$tunnelRunning = $false
$pidVal = $null
if (Test-Path $tunnelPid) {
  $pidVal = (Get-Content $tunnelPid -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($pidVal) { $pidVal = $pidVal.ToString().Trim() }
  $tunnelRunning = $pidVal -and (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)
}
if (-not $tunnelRunning) {
  $tunnelRunning = [bool](Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1)
}
if (Test-Path $tunnelYml) {
  Row "Cloudflare tunnel running" $tunnelRunning $(if (-not $tunnelRunning) { "Start Kwalify to launch tunnel" } else { "active" })
}

# API
$apiUp = $false
try {
  $rz = Invoke-RestMethod "http://127.0.0.1:5000/api/readyz" -TimeoutSec 3
  $apiUp = ($rz.status -eq "ready" -or $rz.readiness -eq "ready")
} catch {}
Row "API server running (port 5000)" $apiUp $(if (-not $apiUp) { "Run: Start Kwalify" } else { "ready" })

# Key frontend routes
$statusRouteOk = $false
$settingsRouteOk = $false
$benchmarkRouteOk = $false
if ($apiUp) {
  try {
    $statusRouteOk = (Invoke-WebRequest "http://127.0.0.1:5000/status" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200
  } catch {}
  try {
    $settingsRouteOk = (Invoke-WebRequest "http://127.0.0.1:5000/settings" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200
  } catch {}
  try {
    $benchmarkRouteOk = (Invoke-WebRequest "http://127.0.0.1:5000/benchmark" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200
  } catch {}
}
Row "/status page route" $statusRouteOk $(if (-not $statusRouteOk) { "Stop then Start Kwalify to load latest build" } else { "OK" })
Row "/settings page route" $settingsRouteOk $(if (-not $settingsRouteOk) { "Stop then Start Kwalify to load latest build" } else { "OK" })
Row "/benchmark page route" $benchmarkRouteOk $(if (-not $benchmarkRouteOk) { "Stop then Start Kwalify to load latest build" } else { "OK" })

# Public HTTPS
$publicOk = $false
$localHttpsOk = $false
$hostsOverride = $false
try {
  $hostsContent = Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" -ErrorAction SilentlyContinue
  $hostsOverride = [bool]($hostsContent | Where-Object { $_ -match '^\s*127\.0\.0\.1\s+kwalify\.net' })
} catch {}
if ($hostsOverride) {
  WarnRow "hosts file override" "127.0.0.1 kwalify.net blocks Cloudflare on this PC - run remove-local-hosts.bat as Admin"
}
if ($appUrl) {
  try {
    $pub = Invoke-RestMethod "$appUrl/api/readyz" -TimeoutSec 10
    $publicOk = ($pub.status -eq "ready" -or $pub.readiness -eq "ready")
    $localHttpsOk = $publicOk
    if ($apiUp -and $publicOk) {
      try {
        $local = Invoke-RestMethod "http://127.0.0.1:5000/api/readyz" -TimeoutSec 3
        if ($local.uptimeMs -and $pub.uptimeMs -and [math]::Abs($local.uptimeMs - $pub.uptimeMs) -gt 120000) {
          $publicOk = $false
          WarnRow "DNS routing" "kwalify.net points at a different server - run fix-cloudflare-dns.bat"
        }
      } catch {}
    }
  } catch {}
  if ($tunnelRunning -and $publicOk) {
    Row "Public site reachable ($appUrl)" $true "friends can connect"
  } elseif ($tunnelRunning -and -not $publicOk) {
    Row "Public site reachable ($appUrl)" $false "Tunnel running but site not responding - check reports\cloudflared.log"
  } elseif ($localHttpsOk) {
    WarnRow "Public site ($appUrl)" "Works on THIS PC only (hosts file). Friends need Cloudflare tunnel running."
  } else {
    Row "Public site reachable ($appUrl)" $false "Start Kwalify (API + tunnel)"
  }
} else {
  WarnRow "APP_URL not set" "Set APP_URL=https://kwalify.net in .env for public checks"
}

# Firewall
$fwApi = Get-NetFirewallRule -DisplayName "Kwalify API" -ErrorAction SilentlyContinue
$fwHttps = Get-NetFirewallRule -DisplayName "Kwalify HTTPS" -ErrorAction SilentlyContinue
if ($fwApi -and $fwHttps) {
  Row "Windows Firewall open" $true "ports 5000 + 443"
} else {
  WarnRow "Windows Firewall" "Optional with Cloudflare tunnel - run open-firewall-admin.bat as Admin if needed"
}

# DB backup task
$backupTask = Get-ScheduledTask -TaskName "Kwalify-Daily-DB-Backup" -ErrorAction SilentlyContinue
if ($backupTask) {
  Row "Daily DB backup scheduled" $true "3:00 AM to backups\"
} else {
  WarnRow "Daily DB backup" "Run scripts\schedule-db-backup.ps1 once (Admin)"
}

$backupDir = Join-Path $Root "backups"
$latestBackup = Get-ChildItem -LiteralPath $backupDir -Filter "kwalify-*.dump" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latestBackup) {
  $backupAgeH = ((Get-Date) - $latestBackup.LastWriteTime).TotalHours
  Row "Latest DB backup" ($backupAgeH -le 48) "$($latestBackup.Name) ($([math]::Round($backupAgeH, 1))h ago)"
} else {
  WarnRow "Latest DB backup" "None yet — run npm run backup:db"
}

$weeklyTask = Get-ScheduledTask -TaskName "Kwalify-Weekly-Maintenance" -ErrorAction SilentlyContinue
if ($weeklyTask) {
  Row "Weekly maintenance scheduled" $true "Sundays 10:00 AM"
} else {
  WarnRow "Weekly maintenance" "Run maintain.bat weekly, or scripts\schedule-weekly-maintenance.ps1 once (Admin)"
}

# Spotify credentials in .env
$spotifyOk = $false
if (Test-Path $envPath) {
  $hasId = [bool](Select-String -Path $envPath -Pattern '^\s*SPOTIFY_CLIENT_ID=\S+' -Quiet)
  $hasSecret = [bool](Select-String -Path $envPath -Pattern '^\s*SPOTIFY_CLIENT_SECRET=\S+' -Quiet)
  $spotifyOk = $hasId -and $hasSecret
}
Row "Spotify app credentials in .env" $spotifyOk $(if (-not $spotifyOk) { "Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET" } else { "configured" })

$apiLog = Join-Path $Root "kwalify-api.log"
if (Test-Path -LiteralPath $apiLog) {
  $logMb = [math]::Round((Get-Item $apiLog).Length / 1MB, 1)
  if ($logMb -gt 8) {
    WarnRow "kwalify-api.log size" "${logMb} MB — rotates at 10 MB automatically"
  }
}

Write-Host ""
if ($fail -eq 0 -and $publicOk -and $tunnelRunning) {
  Write-Host "  READY FOR BETA - share $appUrl with your testers" -ForegroundColor Green
} elseif ($fail -eq 0 -and $apiUp) {
  Write-Host "  Local API ready - start tunnel for public beta at $appUrl" -ForegroundColor Yellow
} elseif ($fail -eq 0 -and $localHttpsOk) {
  Write-Host "  OK on this PC - start tunnel so friends can reach $appUrl" -ForegroundColor Yellow
} elseif ($fail -eq 0) {
  Write-Host "  Almost ready - complete the [!!] items above" -ForegroundColor Yellow
} else {
  Write-Host "  Not ready yet - fix [!!] items, then Start Kwalify" -ForegroundColor Yellow
}
Write-Host ""
