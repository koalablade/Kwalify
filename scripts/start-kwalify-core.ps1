param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [ValidateSet("local", "domain", "selfhost")]
  [string]$Mode = "domain",
  [switch]$Build,
  [switch]$NoPull,
  [switch]$Quick,
  [switch]$NoWatch
)

$ErrorActionPreference = "Stop"
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {}
Set-Location $Root

$logPath = Join-Path $Root "kwalify-start.log"
if (Test-Path -LiteralPath $logPath) {
  $logSizeMb = (Get-Item -LiteralPath $logPath).Length / 1MB
  if ($logSizeMb -gt 2) {
    $rotated = "$logPath.old"
    if (Test-Path -LiteralPath $rotated) { Remove-Item -LiteralPath $rotated -Force }
    Move-Item -LiteralPath $logPath -Destination $rotated -Force
    Write-Host "  Rotated kwalify-start.log (>2MB)"
  }
}
$transcriptStarted = $false
try {
  Start-Transcript -Path $logPath -Append | Out-Null
  $transcriptStarted = $true
  Write-Host "---- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') start-kwalify ----"
} catch {
  Write-Host "  (Could not write kwalify-start.log - continuing anyway)"
}

$launcherLock = Join-Path $env:TEMP "kwalify-launcher.lock"
$lockStream = $null
try {
  $lockStream = [System.IO.File]::Open($launcherLock, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  Write-Host ""
  Write-Host "  Kwalify is already starting in another window." -ForegroundColor Yellow
  Write-Host "  Wait for it to finish, or close the other launcher first."
  Write-Host "  If stuck, delete: $launcherLock"
  Exit-Launcher 1 "Another Kwalify launcher is already running."
}

function Step([string]$msg) {
  Write-Host ""
  Write-Host ">> $msg" -ForegroundColor Cyan
}

# Native tools (git, npm) write progress to stderr; do not let that abort under Stop.
function Invoke-Native([scriptblock]$Command) {
  $prevErr = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Command
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevErr
  }
}

# Health probes during startup — avoid TerminatingError lines in Start-Transcript.
function Invoke-QuietRest {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [int]$TimeoutSec = 4
  )
  $prevErr = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    return Invoke-RestMethod -Uri $Uri -TimeoutSec $TimeoutSec -ErrorAction Stop
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $prevErr
  }
}

function Start-HealthWatch {
  if ($NoWatch) {
    Write-Host "  Health watch skipped (-NoWatch)"
    return
  }
  if ($Mode -ne "selfhost") {
    return
  }
  $watchScript = Join-Path $Root "scripts\watch-local-health.ps1"
  $pidFile = Join-Path $Root "reports\.kwalify-watchdog.pid"
  if (Test-Path -LiteralPath $pidFile) {
    $existingPid = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
      Write-Host "  Health watch already running (PID $existingPid)" -ForegroundColor DarkGray
      return
    }
  }
  if (-not (Test-Path -LiteralPath $watchScript)) {
    Write-Host "  Health watch script missing — skipped" -ForegroundColor Yellow
    return
  }
  $reportsDir = Join-Path $Root "reports"
  if (-not (Test-Path -LiteralPath $reportsDir)) {
    New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
  }
  $cmd = "& { `$Host.UI.RawUI.WindowTitle = 'Kwalify Health Watch'; & '$watchScript' -Root '$Root' }"
  Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmd) `
    -WorkingDirectory $Root -WindowStyle Minimized | Out-Null
  Write-Host "  Health watch started (auto-repairs API + tunnel)" -ForegroundColor Green
}

function PortOpen([int]$port) {
  try {
    return $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
  } catch { return $false }
}

function Set-EnvFileLine([string]$path, [string]$key, [string]$value) {
  $lines = if (Test-Path $path) { Get-Content $path } else { @() }
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match "^\s*$([regex]::Escape($key))\s*=") {
      $found = $true
      "$key=$value"
    } else { $line }
  }
  if (-not $found) { $out += "$key=$value" }
  Set-Content -LiteralPath $path -Value $out -Encoding UTF8
}

function Apply-DotEnvLine([string]$key, [string]$value) {
  Set-Item -Path "env:$key" -Value $value
}

function Load-DotEnvFile([string]$path) {
  if (-not (Test-Path $path)) { return }
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    if ($t -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $v = $Matches[2].Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    Apply-DotEnvLine $Matches[1] $v
  }
}

function Ensure-EnvFile([string]$path, [string]$examplePath) {
  if (Test-Path -LiteralPath $path) { return }
  if (Test-Path -LiteralPath $examplePath) {
    Copy-Item -LiteralPath $examplePath -Destination $path
    Write-Host "  Created .env from .env.example"
    return
  }
  $template = @"
DATABASE_URL=postgresql://kwalify:kwalify@localhost:5432/kwalify
SESSION_SECRET=change-me-to-a-random-string-at-least-32-characters
PORT=5000
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback
NODE_ENV=development
APP_URL=https://kwalify.net
"@
  Set-Content -LiteralPath $path -Value $template.TrimEnd() -Encoding UTF8
  Write-Host "  Created .env with default local settings"
}

function Ensure-HostsEntry {
  $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
  $content = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
  if ($content -match 'kwalify\.net') { return $true }
  Write-Host "  Adding kwalify.net to hosts (Admin prompt)..." -ForegroundColor Yellow
  $addScript = @"
`$p = '$hostsPath'
if (-not (Select-String -Path `$p -Pattern 'kwalify\.net' -Quiet)) {
  Add-Content -Path `$p -Value "`n127.0.0.1 kwalify.net"
}
"@
  $tmp = Join-Path $env:TEMP "kwalify-hosts.ps1"
  Set-Content $tmp $addScript -Encoding UTF8
  try {
    Start-Process powershell -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $tmp) -Wait
  } catch {
    return $false
  }
  Start-Sleep -Seconds 1
  $content = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
  return ($content -match 'kwalify\.net')
}

function Ensure-LocalCerts {
  $cert = Join-Path $Root "kwalify.net.pem"
  $key = Join-Path $Root "kwalify.net-key.pem"
  if ((Test-Path $cert) -and (Test-Path $key)) { return $true }
  Write-Host "  Creating local HTTPS certs (one-time)..." -ForegroundColor Yellow
  $mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
  if (-not $mkcert) {
    $wingetMkcert = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\FiloSottile.mkcert_Microsoft.Winget.Source_8wekyb3d8bbwe\mkcert.exe"
    if (Test-Path $wingetMkcert) {
      $mkcert = Get-Command $wingetMkcert
    }
  }
  if (-not $mkcert) {
    Write-Host "  mkcert not found - installing via winget..." -ForegroundColor Yellow
    try {
      winget install --id FiloSottile.mkcert -e --accept-source-agreements --accept-package-agreements | Out-Host
    } catch {
      Write-Host "  winget install failed: $($_.Exception.Message)"
    }
  }
  $setup = Join-Path $Root "scripts\setup-local-domain.ps1"
  if (-not (Test-Path $setup)) { return $false }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $setup
  return ((Test-Path $cert) -and (Test-Path $key))
}

function Assert-ProjectRoot {
  $marker = Join-Path $Root "package.json"
  if (-not (Test-Path -LiteralPath $marker)) {
    Write-Host "  This does not look like the Kwalify project folder (package.json missing)."
    Write-Host "  Move start-kwalify.bat into your Kwalify repo root, or run it from there."
    Write-Host "  Expected folder: $Root"
    Exit-Launcher 1 "package.json missing - run start-kwalify.bat from the Kwalify project folder."
  }
}

function Ensure-SessionSecret([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $content = Get-Content -LiteralPath $path -Raw
  if ($content -notmatch 'SESSION_SECRET=' -or $content -match 'change-me-to-a-random-string') {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes)
    if ($content -match 'SESSION_SECRET=') {
      $content = $content -replace 'SESSION_SECRET=.*', "SESSION_SECRET=$secret"
    } else {
      $content = "SESSION_SECRET=$secret`n" + $content
    }
    Set-Content -LiteralPath $path -Value $content.TrimEnd()
    Write-Host "  Generated a random SESSION_SECRET in .env"
  }
}

function Test-DatabaseReady([string]$databaseUrl) {
  if (-not $databaseUrl) { return $false }
  $psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
  if (-not (Test-Path $psql)) { return $true }
  try {
    $env:PGPASSWORD = "kwalify"
    & $psql -U kwalify -h localhost -d kwalify -t -c "SELECT 1" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

function Ensure-DatabaseReady {
  $setup = Join-Path $Root "scripts\setup-local-dev.ps1"
  if (-not (Test-Path $setup)) { return }
  Write-Host "  Database not ready - running one-time setup (Admin prompt)..." -ForegroundColor Yellow
  try {
    Start-Process powershell -Verb RunAs -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $setup
    ) -Wait
  } catch {
    Write-Host "  Database setup was cancelled or failed."
    Write-Host "  Run as Admin: powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-dev.ps1"
    Exit-Launcher 1 "Database setup was cancelled or failed."
  }
}

function Test-SiteReady([string]$url) {
  $rz = Invoke-QuietRest -Uri "$url/api/readyz" -TimeoutSec 4
  if (-not $rz) { return $false }
  return ($rz.status -eq "ready" -or $rz.readiness -eq "ready")
}

function Stop-PortListeners([int]$port) {
  if (-not (PortOpen $port)) { return }
  $allowed = @("node", "local-ssl-proxy", "cloudflared", "powershell")
  $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($allowed -contains $proc.ProcessName) {
      Write-Host "  Stopping $($proc.ProcessName) on port $port (pid $procId)..."
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    } else {
      Write-Host "  Port $port held by $($proc.ProcessName) (pid $procId) - not stopping (not Kwalify)" -ForegroundColor Yellow
    }
  }
  Start-Sleep -Seconds 2
}

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal $id
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-Port443Bindable {
  if (PortOpen 443) { return $true }
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 443)
    $listener.Start()
    $listener.Stop()
    return $true
  } catch {
    return $false
  }
}

function Open-StartHelpPage([string]$Reason) {
  $base = "http://127.0.0.1:5000"
  $uri = "$base/local-start-help.html"
  if ($Reason) {
    $uri += "?reason=" + [uri]::EscapeDataString($Reason)
  }
  try {
    $rz = Invoke-QuietRest -Uri "$base/api/healthz" -TimeoutSec 3
    if ($rz) {
      Start-Process $uri | Out-Null
      return
    }
  } catch {}
  $help = Join-Path $Root "frontend\public\local-start-help.html"
  if (-not (Test-Path -LiteralPath $help)) { return }
  $fileUri = "file:///$($help.Replace('\', '/'))"
  if ($Reason) {
    $fileUri += "?reason=" + [uri]::EscapeDataString($Reason)
  }
  Start-Process $fileUri | Out-Null
}

function Exit-Launcher([int]$code, [string]$reason) {
  if ($code -ne 0 -and $reason) {
    Write-Host ""
    Write-Host "  $reason" -ForegroundColor Red
    Write-Host "  Details saved to: $logPath" -ForegroundColor DarkYellow
    Open-StartHelpPage -Reason $reason
  }
  if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
  exit $code
}

function Warn-NodeVersion {
  try {
    $version = (node -v).TrimStart("v")
    $major = [int]($version.Split(".")[0])
    if ($major -ne 20) {
      Write-Host "  Warning: Node $version detected. Kwalify targets Node 20.x (LTS)." -ForegroundColor Yellow
      Write-Host "  Install Node 20: https://nodejs.org  or run: nvm install 20 && nvm use 20"
      if (Test-Path -LiteralPath (Join-Path $Root ".nvmrc")) {
        Write-Host "  This repo includes .nvmrc (20) for version managers." -ForegroundColor DarkGray
      }
      if ($Mode -eq "selfhost" -and $env:KWALIFY_STRICT_NODE -eq "1") {
        Exit-Launcher 1 "Node 20.x required (set KWALIFY_STRICT_NODE=0 to override)."
      }
    }
  } catch {}
}

function Stop-ExistingKwalify {
  $healthLib = Join-Path $Root "scripts\kwalify-health-lib.ps1"
  $generationBusy = $false
  if ($Mode -eq "selfhost" -and (Test-Path -LiteralPath $healthLib)) {
    . $healthLib -Root $Root
    if (Test-KwalifyGenerationBusy) {
      $generationBusy = $true
      Write-Host "  Playlist generation or benchmark is active on port 5000." -ForegroundColor Yellow
      Write-Host "  Waiting up to 90s before stopping API (or press Ctrl+C to abort)..." -ForegroundColor Yellow
      $waitUntil = (Get-Date).AddSeconds(90)
      while ((Get-Date) -lt $waitUntil) {
        if (-not (Test-KwalifyGenerationBusy)) { break }
        Start-Sleep -Seconds 5
      }
      if (Test-KwalifyGenerationBusy) {
        Write-Host "  Generation still active — skipping API stop to avoid killing in-flight playlists." -ForegroundColor Yellow
        Write-Host "  Use stop-kwalify.bat to force-stop, or wait for generation to finish." -ForegroundColor Yellow
        return
      }
    }
  }
  $stopped = $false
  if (PortOpen 5000) {
    if ($generationBusy) {
      Write-Host "  Generation finished — stopping API on port 5000..."
    } else {
      Write-Host "  Stopping old API on port 5000 (fresh start with latest code)..."
    }
    Stop-PortListeners 5000
    $stopped = $true
  }
  if (PortOpen 443) {
    Write-Host "  Stopping old HTTPS proxy on port 443..."
    Stop-PortListeners 443
    $stopped = $true
  }
  if ($stopped) { Start-Sleep -Seconds 1 }
}

function Test-BuildStale {
  $dist = Join-Path $Root "backend\dist\server.js"
  if (-not (Test-Path -LiteralPath $dist)) { return $true }
  $distTime = (Get-Item -LiteralPath $dist).LastWriteTimeUtc
  foreach ($marker in @("package.json", "package-lock.json")) {
    $markerPath = Join-Path $Root $marker
    if ((Test-Path -LiteralPath $markerPath) -and (Get-Item -LiteralPath $markerPath).LastWriteTimeUtc -gt $distTime) {
      return $true
    }
  }
  foreach ($srcRoot in @("backend", "frontend\public")) {
    $fullRoot = Join-Path $Root $srcRoot
    if (-not (Test-Path -LiteralPath $fullRoot)) { continue }
    $newer = Get-ChildItem -Path $fullRoot -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object {
        $_.FullName -notmatch '\\node_modules\\|\\dist\\|\\.git\\' -and
        $_.Extension -match '^\.(ts|tsx|js|json|html|css)$' -and
        $_.LastWriteTimeUtc -gt $distTime
      } |
      Select-Object -First 1
    if ($newer) { return $true }
  }
  return $false
}

function Invoke-GitPull {
  $skipFile = Join-Path $Root ".kwalify-nopull"
  if ($NoPull -or (Test-Path -LiteralPath $skipFile)) {
    Write-Host "  git pull skipped"
    return $false
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  git not found - skipping pull"
    return $false
  }
  Step "Checking for updates (git pull)"
  Push-Location $Root
  try {
    $branch = (git rev-parse --abbrev-ref HEAD 2>$null)
    if (-not $branch) {
      Write-Host "  Not a git repo - skipping pull"
      return $false
    }
    $before = (git rev-parse HEAD 2>$null)
    $prevErr = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $pullOutput = & git pull --ff-only 2>&1
    $pullExit = $LASTEXITCODE
    $ErrorActionPreference = $prevErr
    if ($pullOutput) {
      $pullOutput | ForEach-Object { Write-Host "  $_" }
    }
    if ($pullExit -ne 0) {
      Write-Host "  git pull failed (local changes or offline). Continuing with current code." -ForegroundColor Yellow
      return $false
    }
    $after = (git rev-parse HEAD 2>$null)
    if ($before -and $after -and $before -ne $after) {
      Write-Host "  Updated to latest code - will rebuild"
      return $true
    }
    Write-Host "  Already up to date"
    return $false
  } finally {
    Pop-Location
  }
}

function Ensure-DesktopShortcuts {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $startLnk = Join-Path $desktop "Start Kwalify.lnk"
  if (Test-Path -LiteralPath $startLnk) { return }
  $script = Join-Path $Root "scripts\create-kwalify-shortcuts.ps1"
  if (-not (Test-Path -LiteralPath $script)) { return }
  Write-Host "  Creating Desktop shortcuts (one time)..." -ForegroundColor DarkCyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Root $Root
}

function Invoke-SmokeChecks {
  if (-not (Test-Path (Join-Path $Root "backend\dist\server.js"))) { return }
  $auditScript = Join-Path $Root "scripts\run-startup-audits.ps1"
  if (Test-Path -LiteralPath $auditScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $auditScript -Root $Root -Phase tests -Mode $Mode
    if ($LASTEXITCODE -ne 0) {
      Exit-Launcher 1 "Startup test audits failed (smoke / observability)."
    }
    return
  }
  $prevErr = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  Step "Quick smoke check"
  $output = & npm run test:smoke 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $ErrorActionPreference = $prevErr
    Write-Host "  Smoke tests failed - fix before generating playlists." -ForegroundColor Yellow
    $output | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    Exit-Launcher 1 "Smoke tests failed (npm run test:smoke)."
  }
  Write-Host "  Smoke tests passed"
  $ErrorActionPreference = $prevErr
}

function Invoke-PostApiStartupAudits([string]$liveUrl) {
  $auditScript = Join-Path $Root "scripts\run-startup-audits.ps1"
  if (-not (Test-Path -LiteralPath $auditScript)) { return }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $auditScript -Root $Root -Phase post -Mode $Mode -LiveUrl $liveUrl
}

function Start-HttpsProxy([string]$proxy, [string]$cert, [string]$key, [int]$targetPort) {
  if (-not (Test-Port443Bindable)) {
    Exit-Launcher 1 "Port 443 is blocked. Right-click start-kwalify.bat and choose Run as administrator."
  }
  & $proxy --source 443 --target $targetPort --cert $cert --key $key
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    $msg = "HTTPS proxy failed on port 443."
    if (-not (Test-IsAdmin)) { $msg += " Try Run as administrator." }
    Exit-Launcher 1 $msg
  }
}

# --- 0. Project + Node ---
Assert-ProjectRoot
Ensure-DesktopShortcuts
$pullUpdated = Invoke-GitPull
if (-not $Quick) {
  Stop-ExistingKwalify
}

Step "Checking Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  Node.js not found. Install from https://nodejs.org (LTS), then run this bat again."
  Start-Process "https://nodejs.org" | Out-Null
  Exit-Launcher 1 "Node.js is not installed."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "  npm not found. Reinstall Node.js from https://nodejs.org (LTS)."
  Exit-Launcher 1 "npm is not installed."
}
Write-Host "  node $((node -v))"
Warn-NodeVersion

# --- 1. Postgres ---
Step "Checking PostgreSQL"
$pg = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pg) {
  Write-Host "  PostgreSQL not installed."
  Write-Host "  1) Install PostgreSQL 18 from https://www.postgresql.org/download/windows/"
  Write-Host "  2) Right-click this bat -> Run as administrator, OR run in Admin PowerShell:"
  Write-Host "       npm run db:setup-local-dev"
  Start-Process "https://www.postgresql.org/download/windows/" | Out-Null
  Exit-Launcher 1 "PostgreSQL is not installed."
}
if ($pg.Status -ne "Running") {
  Write-Host "  Starting $($pg.Name)..."
  Start-Service $pg.Name
  Start-Sleep -Seconds 2
}
Write-Host "  $($pg.Name): running"

# --- 2. .env ---
Step "Checking .env"
$envPath = Join-Path $Root ".env"
$examplePath = Join-Path $Root ".env.example"
Ensure-EnvFile $envPath $examplePath
Ensure-SessionSecret $envPath

$port = 5000
if ($Mode -eq "local") {
  Set-EnvFileLine $envPath "PORT" "5000"
  Set-EnvFileLine $envPath "NODE_ENV" "development"
  Set-EnvFileLine $envPath "APP_URL" "http://localhost:5000"
  Set-EnvFileLine $envPath "SPOTIFY_REDIRECT_URI" "http://localhost:5000/api/auth/callback"
  $siteUrl = "http://localhost:5000"
  $redirectUri = "http://localhost:5000/api/auth/callback"
} elseif ($Mode -eq "selfhost") {
  $removeHosts = Join-Path $Root "scripts\remove-kwalify-hosts.ps1"
  if (Test-Path -LiteralPath $removeHosts) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $removeHosts -Quiet
  }
  Set-EnvFileLine $envPath "PORT" "5000"
  Set-EnvFileLine $envPath "BIND_HOST" "0.0.0.0"
  Set-EnvFileLine $envPath "KWALIFY_HOST_MODE" "selfhost"
  if (-not (Select-String -Path $envPath -Pattern '^\s*GENERATE_CONCURRENCY_LIMIT\s*=' -Quiet)) {
    Set-EnvFileLine $envPath "GENERATE_CONCURRENCY_LIMIT" "2"
  }
  if (-not (Select-String -Path $envPath -Pattern '^\s*GENERATE_QUEUE_LIMIT\s*=' -Quiet)) {
    Set-EnvFileLine $envPath "GENERATE_QUEUE_LIMIT" "4"
  }
  Load-DotEnvFile $envPath
  if (-not $env:APP_URL) {
    Set-EnvFileLine $envPath "APP_URL" "https://kwalify.net"
    Set-EnvFileLine $envPath "FRONTEND_URL" "https://kwalify.net"
    Set-EnvFileLine $envPath "KWALIFY_EXPOSURE" "cloudflare"
    Load-DotEnvFile $envPath
  }
  if ($env:NODE_ENV -ne "production") {
    Set-EnvFileLine $envPath "NODE_ENV" "production"
  }
  $siteUrl = $env:APP_URL.TrimEnd("/")
  if (-not $env:SPOTIFY_REDIRECT_URI) {
    Set-EnvFileLine $envPath "SPOTIFY_REDIRECT_URI" "$siteUrl/api/auth/callback"
  }
  if (-not $env:FRONTEND_URL) {
    Set-EnvFileLine $envPath "FRONTEND_URL" $siteUrl
  }
  Load-DotEnvFile $envPath
  $redirectUri = $env:SPOTIFY_REDIRECT_URI
} else {
  Set-EnvFileLine $envPath "PORT" "5000"
  Set-EnvFileLine $envPath "NODE_ENV" "development"
  Set-EnvFileLine $envPath "APP_URL" "https://kwalify.net"
  Set-EnvFileLine $envPath "SPOTIFY_REDIRECT_URI" "https://kwalify.net/api/auth/callback"
  $siteUrl = "https://kwalify.net"
  $redirectUri = "https://kwalify.net/api/auth/callback"
}

Load-DotEnvFile $envPath
$port = if ($env:PORT) { [int]$env:PORT } else { 5000 }

if (-not $env:SPOTIFY_CLIENT_ID -or -not $env:SPOTIFY_CLIENT_SECRET) {
  Write-Host ""
  Write-Host "  SPOTIFY SETUP REQUIRED (one time):" -ForegroundColor Yellow
  Write-Host "  1. Open https://developer.spotify.com/dashboard"
  Write-Host "  2. Your app -> Settings"
  Write-Host "  3. Redirect URIs -> Add exactly:"
  Write-Host "       $redirectUri"
  Write-Host "  4. Copy Client ID and Client Secret into .env"
  Write-Host "  5. Run this bat again"
  Write-Host ""
  Start-Process "https://developer.spotify.com/dashboard" | Out-Null
  Start-Process notepad $envPath | Out-Null
  Exit-Launcher 1 "Add Spotify Client ID and Secret to .env, then run again."
}

Load-DotEnvFile $envPath
if (-not (Test-DatabaseReady $env:DATABASE_URL)) {
  Step "Checking database"
  Ensure-DatabaseReady
  Load-DotEnvFile $envPath
  if (-not (Test-DatabaseReady $env:DATABASE_URL)) {
    Write-Host "  Database still not reachable."
    Write-Host "  Run as Admin: powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-dev.ps1"
    Exit-Launcher 1 "Database is not reachable."
  }
  Write-Host "  Database: OK"
}

$port = if ($env:PORT) { [int]$env:PORT } else { 5000 }

# --- Fast path: already running (quick mode only) ---
if ($Quick -and $Mode -eq "domain" -and (Test-SiteReady "http://127.0.0.1:$port")) {
  Step "Kwalify already running"
  Write-Host "  API is up on port $port"
  if (Test-SiteReady "https://kwalify.net") {
    Write-Host "  HTTPS proxy is up - opening site"
    if ($lockStream) { $lockStream.Dispose(); $lockStream = $null }
    Start-Process "https://kwalify.net" | Out-Null
    Write-Host ""
    Write-Host "  Leave the Kwalify API window open. Press Ctrl+C here only stops the proxy."
    if (-not (PortOpen 443)) {
      $proxy = Join-Path $Root "node_modules\.bin\local-ssl-proxy.cmd"
      $cert = Join-Path $Root "kwalify.net.pem"
      $key = Join-Path $Root "kwalify.net-key.pem"
      if ((Test-Path $proxy) -and (Test-Path $cert) -and (Test-Path $key)) {
        Start-HttpsProxy $proxy $cert $key $port
      }
    }
    if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
    exit 0
  }
  Write-Host "  Restarting HTTPS proxy..."
}

# --- 3. Domain prerequisites (Spotify requires kwalify.net) ---
if ($Mode -eq "domain") {
  Step "Checking kwalify.net local domain"
  if (-not (Ensure-HostsEntry)) {
    Write-Host "  Could not add kwalify.net to hosts."
    Write-Host "  Run as Admin: powershell -ExecutionPolicy Bypass -File .\scripts\add-kwalify-hosts.ps1"
    Exit-Launcher 1 "kwalify.net is not in the hosts file."
  }
  Write-Host "  hosts: kwalify.net -> 127.0.0.1"
  if (-not (Ensure-LocalCerts)) {
    Write-Host "  Could not create HTTPS certs."
    Write-Host "  Install mkcert: winget install FiloSottile.mkcert"
    Write-Host "  Then run: npm run setup:local-domain"
    Exit-Launcher 1 "Local HTTPS certificates are missing."
  }
  Write-Host "  TLS certs: OK"
  $proxy = Join-Path $Root "node_modules\.bin\local-ssl-proxy.cmd"
  if (-not (Test-Path $proxy)) {
    Write-Host "  local-ssl-proxy missing - will install dependencies next."
  }
  if (PortOpen 443) {
    Stop-PortListeners 443
  }
  if (-not (Test-IsAdmin)) {
    Write-Host "  Tip: if HTTPS fails below, right-click this bat -> Run as administrator" -ForegroundColor DarkYellow
  }
}

# --- 4. Dependencies ---
if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Step "Installing dependencies (first time only)"
  if ((Invoke-Native { npm ci }) -ne 0) { Exit-Launcher $LASTEXITCODE "npm ci failed." }
}

# --- 5. Build ---
Step "Building"
$dist = Join-Path $Root "backend\dist\server.js"
$buildStale = Test-BuildStale
if ($Build -or $pullUpdated -or $buildStale -or -not (Test-Path -LiteralPath $dist)) {
  if ($pullUpdated) {
    Write-Host "  Rebuilding after git pull..."
  } elseif ($buildStale) {
    Write-Host "  Source code changed since last build - rebuilding..."
  } elseif ($Build) {
    Write-Host "  Forced rebuild (build flag)..."
  } else {
    Write-Host "  First build..."
  }
  if ((Invoke-Native { npm run build }) -ne 0) { Exit-Launcher $LASTEXITCODE "npm run build failed." }
  Write-Host "  Build OK"
} else {
  Write-Host "  OK (already built - pass build to force)"
}

Invoke-SmokeChecks

# --- 6. API ---
Step "Starting server"
$localAppUrl = $siteUrl
$localRedirect = $redirectUri
$nodeEnv = if ($Mode -eq "selfhost") { "production" } else { "development" }
$rootEsc = $Root.Replace("'", "''")
$reuseRunningApi = $false

if (PortOpen $port) {
  $healthLib = Join-Path $Root "scripts\kwalify-health-lib.ps1"
  if ($Mode -eq "selfhost" -and (Test-Path -LiteralPath $healthLib)) {
    . $healthLib -Root $Root
    if (Test-KwalifyGenerationBusy) {
      Write-Host "  Generation active — reusing running API on port $port" -ForegroundColor Yellow
      $reuseRunningApi = $true
    } else {
      Stop-PortListeners $port
    }
  } else {
    Stop-PortListeners $port
  }
}

if (-not $reuseRunningApi) {
$apiPs1 = Join-Path $env:TEMP "kwalify-api-$([Guid]::NewGuid().ToString('n')).ps1"
$apiBody = @"
`$host.UI.RawUI.WindowTitle = 'Kwalify API'
Set-Location '$rootEsc'
foreach (`$line in Get-Content '.env') {
  `$t = `$line.Trim()
  if (-not `$t -or `$t.StartsWith('#')) { continue }
  if (`$t -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    `$v = `$Matches[2].Trim().Trim('"').Trim("'")
    Set-Item "env:`$(`$Matches[1])" `$v
  }
}
`$env:APP_URL = '$localAppUrl'
`$env:SPOTIFY_REDIRECT_URI = '$localRedirect'
`$env:NODE_ENV = '$nodeEnv'
`$env:PORT = '$port'
if (-not `$env:LOG_LEVEL) { `$env:LOG_LEVEL = 'info' }
`$env:GIT_COMMIT = (git rev-parse HEAD 2>`$null)
if (-not `$env:GIT_COMMIT) { `$env:GIT_COMMIT = 'local-dev' }
Write-Host ''
Write-Host 'KWALIFY SERVER - keep this window OPEN' -ForegroundColor Green
Write-Host 'Site:' '$localAppUrl'
Write-Host 'Spotify callback:' '$localRedirect'
Write-Host 'Log file:' (Join-Path '$rootEsc' 'kwalify-api.log')
Write-Host ''
`$logPath = Join-Path '$rootEsc' 'kwalify-api.log'
if ((Test-Path `$logPath) -and ((Get-Item `$logPath).Length / 1MB) -gt 10) {
  `$rotated = "`$logPath.old"
  if (Test-Path `$rotated) { Remove-Item `$rotated -Force }
  Move-Item `$logPath `$rotated -Force
}
npm start *>&1 | Tee-Object -FilePath `$logPath -Append
"@
Set-Content -LiteralPath $apiPs1 -Value $apiBody -Encoding UTF8
Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $apiPs1) -WorkingDirectory $Root -WindowStyle Minimized | Out-Null
}

$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
  $rz = Invoke-QuietRest -Uri "http://localhost:$port/api/readyz" -TimeoutSec 3
  if ($rz -and ($rz.status -eq "ready" -or $rz.readiness -eq "ready")) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Host "  Server did not start in time. Check the Kwalify API window for errors."
  Exit-Launcher 1 "API did not become ready within 120 seconds."
}
Write-Host "  Server ready."

$routeChecks = @("/status", "/settings")
$routeFailed = @()
foreach ($route in $routeChecks) {
  try {
    $code = (Invoke-WebRequest "http://localhost:$port$route" -UseBasicParsing -TimeoutSec 4).StatusCode
    if ($code -ne 200) { $routeFailed += $route }
  } catch {
    $routeFailed += $route
  }
}
if ($routeFailed.Count -gt 0) {
  Write-Host "  Warning: routes missing ($($routeFailed -join ', ')) - rebuild may be stale." -ForegroundColor Yellow
  Write-Host "  Run: stop-kwalify.bat then Start Kwalify again (or start-kwalify.bat build)" -ForegroundColor Yellow
}

if ($Mode -eq "selfhost") {
  Load-DotEnvFile $envPath
  $exposure = $env:KWALIFY_EXPOSURE
  if (-not $exposure) { $exposure = "cloudflare" }
  if ($exposure -eq "cloudflare") {
    $tunnelScript = Join-Path $Root "scripts\run-cloudflare-tunnel.ps1"
    $tunnelConfig = Join-Path $Root "deploy\cloudflared.yml"
    if ((Test-Path $tunnelScript) -and (Test-Path $tunnelConfig)) {
      Step "Starting Cloudflare tunnel"
      & powershell -NoProfile -ExecutionPolicy Bypass -File $tunnelScript -Root $Root
    } else {
      Step "Finishing Cloudflare tunnel setup"
      $ensure = Join-Path $Root "scripts\ensure-cloudflare-tunnel.ps1"
      $hostName = ([Uri]$siteUrl).Host
      & powershell -NoProfile -ExecutionPolicy Bypass -File $ensure -Root $Root -Hostname $hostName
      if (Test-Path -LiteralPath $tunnelConfig) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $tunnelScript -Root $Root
      } else {
        Exit-Launcher 1 "Cloudflare tunnel not configured. Run start.bat again and complete login."
      }
    }

    Step "Checking public site"
    $publicOk = $false
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      $pub = Invoke-QuietRest -Uri "$siteUrl/api/readyz" -TimeoutSec 8
      if ($pub -and ($pub.status -eq "ready" -or $pub.readiness -eq "ready")) { $publicOk = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $publicOk) {
      Write-Host "  Public site not reachable yet - fixing DNS..." -ForegroundColor Yellow
      $fixDns = Join-Path $Root "scripts\fix-cloudflare-dns.ps1"
      if (Test-Path -LiteralPath $fixDns) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $fixDns -Root $Root
      }
      Start-Sleep -Seconds 5
      $pub = Invoke-QuietRest -Uri "$siteUrl/api/readyz" -TimeoutSec 12
      if ($pub -and ($pub.status -eq "ready" -or $pub.readiness -eq "ready")) { $publicOk = $true }
    }
    if ($publicOk) {
      Write-Host "  Public site ready: $siteUrl" -ForegroundColor Green
    } else {
      Write-Host "  Warning: $siteUrl not responding yet." -ForegroundColor Yellow
      Write-Host "  Keep the Cloudflare Tunnel window open. Error 1033 = tunnel not connected." -ForegroundColor Yellow
      Write-Host "  Local site still works: http://127.0.0.1:$port" -ForegroundColor DarkGray
    }
  }
  elseif ($exposure -eq "caddy") {
    Write-Host "  Caddy mode: run in another Admin window:" -ForegroundColor Cyan
    Write-Host "    caddy run --config deploy\Caddyfile"
  }
  elseif ($exposure -eq "direct") {
    if (PortOpen 443) { Stop-PortListeners 443 }
    $proxy = Join-Path $Root "node_modules\.bin\local-ssl-proxy.cmd"
    $cert = Join-Path $Root "kwalify.net.pem"
    $key = Join-Path $Root "kwalify.net-key.pem"
    if ((Test-Path $proxy) -and (Test-Path $cert) -and (Test-Path $key)) {
      Step "Starting HTTPS proxy (direct)"
      if ($lockStream) { $lockStream.Dispose(); $lockStream = $null }
      Start-Process $siteUrl | Out-Null
      Start-HttpsProxy $proxy $cert $key $port
      if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
      exit 0
    }
    Write-Host "  Direct HTTPS: missing certs - use mkcert for your domain or pick Cloudflare tunnel" -ForegroundColor Yellow
  }

  Invoke-PostApiStartupAudits $siteUrl
}

if ($Mode -ne "selfhost") {
  Invoke-PostApiStartupAudits $siteUrl
}

if ($Mode -eq "domain" -and -not (Test-SiteReady "https://kwalify.net")) {
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-SiteReady "https://kwalify.net") { break }
    Start-Sleep -Seconds 2
  }
}

# --- 7. Open browser + HTTPS proxy ---
Step "Opening site"
Write-Host "  $siteUrl"
Write-Host ""
Write-Host "  Spotify login uses: $redirectUri"
Write-Host "  (must be in your Spotify app Redirect URIs list)"
Write-Host ""

if ($Mode -eq "domain") {
  $proxy = Join-Path $Root "node_modules\.bin\local-ssl-proxy.cmd"
  $cert = Join-Path $Root "kwalify.net.pem"
  $key = Join-Path $Root "kwalify.net-key.pem"
  if (-not (Test-Path $proxy)) { throw "local-ssl-proxy missing - run npm ci" }
  if ($lockStream) { $lockStream.Dispose(); $lockStream = $null }
  Start-Process $siteUrl | Out-Null
  Write-Host "  HTTPS proxy running here (Ctrl+C stops proxy only)."
  Write-Host "  To stop everything: double-click stop-kwalify.bat"
  Start-HttpsProxy $proxy $cert $key $port
  if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
  exit 0
}

if ($Mode -eq "selfhost") {
  if ($lockStream) { $lockStream.Dispose(); $lockStream = $null }
  Start-Process $siteUrl | Out-Null
  Write-Host ""
  Write-Host "  ========================================" -ForegroundColor Green
  Write-Host "  KWALIFY IS RUNNING" -ForegroundColor Green
  Write-Host "  ========================================" -ForegroundColor Green
  Write-Host "  Site:    $siteUrl"
  Write-Host "  Status:  $siteUrl/status"
  Write-Host "  Benchmark: $siteUrl/benchmark"
  Write-Host "  Logs:    kwalify-api.log, kwalify-watchdog.log"
  Write-Host ""
  Write-Host "  KEEP OPEN: Kwalify API + Cloudflare Tunnel windows"
  Write-Host "  Health watch runs in background (auto-repair)"
  Write-Host "  Stop:      stop-kwalify.bat"
  Write-Host "  Weekly:    maintain.bat (also runs automatically if >7 days since last)"
  Write-Host ""
  Start-HealthWatch
  if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
  exit 0
}

Start-Process $siteUrl | Out-Null
if ($lockStream) { $lockStream.Dispose() }
if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
