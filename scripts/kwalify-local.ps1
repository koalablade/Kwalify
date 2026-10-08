# The one Kwalify launcher (used by KWALIFY-START.bat / KWALIFY-STOP.bat).
#
#   start : check prerequisites + PostgreSQL, build only if stale, run the existing
#           server (node backend/dist/server.js, i.e. what `npm start` runs) in this
#           console, wait for /api/readyz, then keep showing server logs.
#           If this PC is set up for self-hosting (.env KWALIFY_HOST_MODE=selfhost,
#           Cloudflare exposure, deploy\cloudflared.yml present) it also starts the
#           Cloudflare tunnel in its own minimised window. -NoTunnel skips that.
#   stop  : find THIS Kwalify server process, send it Ctrl+C (graceful SIGINT
#           shutdown, same as pressing Ctrl+C in its window), wait for it to exit;
#           then stop the tunnel, but only if this launcher started it.
#
# Never starts/stops PostgreSQL, never edits .env, never pulls from git, never
# registers scheduled tasks, never kills processes it cannot positively identify as
# its own Kwalify server or tunnel. Written for Windows PowerShell 5.1.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("start", "stop")]
  [string]$Action,
  [switch]$NoTunnel
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ServerEntry = "backend\dist\server.js"
$ServerEntryPattern = 'backend[\\/]+dist[\\/]+server\.js'
$StateDir = Join-Path $Root "reports"
$StateFile = Join-Path $StateDir ".kwalify-local-server.json"
$TunnelStateFile = Join-Path $StateDir ".kwalify-local-tunnel.json"
$TunnelConfig = Join-Path $Root "deploy\cloudflared.yml"
$StopTimeoutSec = 130   # server grace window is 100s for in-flight playlist generations
$ReadyTimeoutSec = 180

function Say([string]$msg, [string]$color = "Gray") { Write-Host $msg -ForegroundColor $color }
function Ok([string]$msg) { Say "  [ok] $msg" "Green" }
function Problem([string]$msg) { Say "  [!!] $msg" "Red" }

# -- .env (existing mechanism; values are never printed) --
function Import-KwalifyEnv {
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path -LiteralPath $envFile)) {
    Problem ".env not found in $Root"
    Say "       Kwalify needs its .env file (copy .env.example to .env and fill it in)." "Yellow"
    return $false
  }
  . (Join-Path $PSScriptRoot "load-dotenv.ps1") -Root $Root
  if (-not $env:PORT) {
    $env:PORT = "5000"
    Say "  PORT not set in .env - using 5000 (same default as the other launchers)." "Yellow"
  }
  return $true
}

function Get-Port { if ($env:PORT) { [int]$env:PORT } else { 5000 } }

# -- Process identification --
function Get-NodeCommandLine([int]$procId) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction Stop
    if ($p -and $p.Name -ieq "node.exe") { return [string]$p.CommandLine }
  } catch {}
  return $null
}

function Test-IsKwalifyServer([int]$procId) {
  $cmd = Get-NodeCommandLine $procId
  return [bool]($cmd -and ($cmd -match $ServerEntryPattern))
}

function Read-State {
  if (-not (Test-Path -LiteralPath $StateFile)) { return $null }
  try { return (Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json) } catch { return $null }
}

function Clear-State([int]$procId) {
  $s = Read-State
  if ($s -and ([int]$s.pid -eq $procId)) { Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue }
}

function Get-PortOwnerIds([int]$port) {
  try {
    return @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique)
  } catch { return @() }
}

# Returns the running Kwalify server process for this repo/port, or $null.
# 1) the PID recorded by KWALIFY-START.bat (verified: same start time, node running server.js)
# 2) otherwise a node process running backend\dist\server.js that owns the Kwalify port
#    (covers servers started by the older start.bat / start-kwalify.bat launchers)
function Find-KwalifyServer([int]$port) {
  $s = Read-State
  if ($s -and $s.pid) {
    $p = Get-Process -Id ([int]$s.pid) -ErrorAction SilentlyContinue
    if ($p) {
      $sameStart = $false
      try { $sameStart = ([math]::Abs($p.StartTime.ToUniversalTime().Ticks - [long]$s.startTicksUtc) -lt 20000000) } catch {}
      if ($sameStart -and (Test-IsKwalifyServer $p.Id)) { return $p }
    }
    Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue   # stale record
  }
  foreach ($ownerId in (Get-PortOwnerIds $port)) {
    if (Test-IsKwalifyServer $ownerId) { return (Get-Process -Id $ownerId -ErrorAction SilentlyContinue) }
  }
  return $null
}

function Get-Readiness([int]$port) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/readyz" -TimeoutSec 4
    return ($r.Content | ConvertFrom-Json)
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      try {
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        return ($reader.ReadToEnd() | ConvertFrom-Json)
      } catch {}
    }
    return $null
  }
}

function Test-Ready([int]$port) {
  $rz = Get-Readiness $port
  return [bool]($rz -and $rz.status -eq "ready")
}

# -- PostgreSQL reachability (TCP only; no credentials used, nothing modified) --
function Test-PostgresReachable {
  if (-not $env:DATABASE_URL) {
    Problem "DATABASE_URL is not set in .env."
    return $false
  }
  $dbHost = "localhost"; $dbPort = 5432
  try {
    $u = [Uri]($env:DATABASE_URL -replace '^postgres(ql)?://', 'http://')
    if ($u.Host) { $dbHost = $u.Host }
    if ($u.Port -gt 0 -and $u.Port -ne 80) { $dbPort = $u.Port }
  } catch {}
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $ok = $client.ConnectAsync($dbHost, $dbPort).Wait(3000) -and $client.Connected
  } catch { $ok = $false } finally { $client.Close() }
  if ($ok) { Ok "PostgreSQL reachable at ${dbHost}:$dbPort"; return $true }

  Problem "PostgreSQL is not reachable at ${dbHost}:$dbPort"
  $svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
  Say ""
  if ($svc) {
    Say "  The PostgreSQL service '$($svc.Name)' is $($svc.Status)." "Yellow"
    Say "  To start it, either:" "Yellow"
    Say "    - press Win+R, type services.msc, find '$($svc.DisplayName)', click Start; or" "Yellow"
    Say "    - in an Administrator PowerShell run:  Start-Service $($svc.Name)" "Yellow"
  } else {
    Say "  No PostgreSQL Windows service was found on this PC." "Yellow"
    Say "  Start your PostgreSQL server (the one DATABASE_URL in .env points to)." "Yellow"
  }
  Say "  Then double-click KWALIFY-START.bat again. (Nothing was changed.)" "Yellow"
  return $false
}

# -- Build (same staleness rule as the existing launcher) --
function Test-BuildStale {
  $dist = Join-Path $Root $ServerEntry
  if (-not (Test-Path -LiteralPath $dist)) { return $true }
  $distTime = (Get-Item -LiteralPath $dist).LastWriteTimeUtc
  foreach ($marker in @("package.json", "package-lock.json", "tsconfig.json")) {
    $m = Join-Path $Root $marker
    if ((Test-Path -LiteralPath $m) -and (Get-Item -LiteralPath $m).LastWriteTimeUtc -gt $distTime) { return $true }
  }
  $backend = Join-Path $Root "backend"
  $newer = Get-ChildItem -Path $backend -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
      $_.FullName -notmatch '\\node_modules\\|\\dist\\|\\\.git\\' -and
      $_.Extension -match '^\.(ts|json)$' -and
      $_.LastWriteTimeUtc -gt $distTime
    } | Select-Object -First 1
  return [bool]$newer
}

# -- Ctrl+C delivery to another console (graceful SIGINT for node) --
function Send-CtrlC([int]$targetPid) {
  $helper = @"
Add-Type -Namespace KwalifyStop -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(System.IntPtr handler, bool add);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint groupId);
'@
[KwalifyStop.Native]::FreeConsole() | Out-Null
if (-not [KwalifyStop.Native]::AttachConsole($targetPid)) { exit 2 }
[KwalifyStop.Native]::SetConsoleCtrlHandler([System.IntPtr]::Zero, `$true) | Out-Null
if (-not [KwalifyStop.Native]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }
Start-Sleep -Milliseconds 500
exit 0
"@
  # Run in a separate hidden process: it must detach from its own console to attach
  # to the server's console, and it ignores the Ctrl+C it sends.
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helper))
  $p = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) `
    -WindowStyle Hidden -Wait -PassThru
  return ($p.ExitCode -eq 0)
}

# -- Auto-start check (report only; changes nothing) --
$KwalifyTaskNames = @("Kwalify-SelfHost-Start", "Kwalify-Uptime-Check", "Kwalify-Weekly-Maintenance", "Kwalify-Daily-DB-Backup")
function Get-KwalifyScheduledTasks {
  $found = @()
  try {
    foreach ($t in (Get-ScheduledTask -ErrorAction Stop)) {
      $actionText = (($t.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -join " ")
      if (($KwalifyTaskNames -contains $t.TaskName) -or ($actionText -and $actionText.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        $found += $t
      }
    }
  } catch {}
  return $found
}

function Show-AutostartWarning {
  $tasks = @(Get-KwalifyScheduledTasks | Where-Object { $_.State -ne "Disabled" })
  if ($tasks.Count -eq 0) { return }
  Say ""
  Say "  Note: Windows still has Kwalify tasks that run on their own:" "Yellow"
  foreach ($t in $tasks) { Say "    - $($t.TaskName)" "Yellow" }
  Say "  To remove them once: double-click TURN-OFF-AUTOSTART.bat" "Yellow"
  Say ""
}

# -- Cloudflare tunnel (only on a PC set up for self-hosting) --
function Get-TunnelPlan {
  # Returns $null when the tunnel should not be started, otherwise the reason it is wanted.
  if ($NoTunnel) { return $null }
  if ($env:KWALIFY_HOST_MODE -ne "selfhost") { return $null }
  $exposure = if ($env:KWALIFY_EXPOSURE) { $env:KWALIFY_EXPOSURE } else { "cloudflare" }
  if ($exposure -ne "cloudflare") { return $null }
  return "selfhost"
}

function Find-CloudflaredExe {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
  )) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

function Get-ProcessCommandLine([int]$procId) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction Stop
    if ($p) { return [string]$p.CommandLine }
  } catch {}
  return $null
}

# A cloudflared process running THIS repo's tunnel config.
function Test-IsKwalifyTunnel([int]$procId) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $p -or $p.ProcessName -ine "cloudflared") { return $false }
  $cmd = Get-ProcessCommandLine $procId
  return [bool]($cmd -and $cmd.IndexOf($TunnelConfig, [StringComparison]::OrdinalIgnoreCase) -ge 0)
}

# The tunnel this launcher started (verified PID + start time + config), or $null.
function Find-OwnedTunnel {
  if (-not (Test-Path -LiteralPath $TunnelStateFile)) { return $null }
  $s = $null
  try { $s = Get-Content -LiteralPath $TunnelStateFile -Raw | ConvertFrom-Json } catch {}
  if ($s -and $s.pid) {
    $p = Get-Process -Id ([int]$s.pid) -ErrorAction SilentlyContinue
    if ($p) {
      $sameStart = $false
      try { $sameStart = ([math]::Abs($p.StartTime.ToUniversalTime().Ticks - [long]$s.startTicksUtc) -lt 20000000) } catch {}
      if ($sameStart -and (Test-IsKwalifyTunnel $p.Id)) { return $p }
    }
  }
  Remove-Item -LiteralPath $TunnelStateFile -Force -ErrorAction SilentlyContinue   # stale record
  return $null
}

# A cloudflared for this config that something else started (old launcher, a service...).
function Find-OtherTunnel {
  foreach ($p in @(Get-Process -Name cloudflared -ErrorAction SilentlyContinue)) {
    if (Test-IsKwalifyTunnel $p.Id) { return $p }
  }
  return $null
}

function Test-HostsPointsLocal([string]$hostName) {
  if (-not $hostName) { return $false }
  $hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
  try {
    foreach ($line in (Get-Content -LiteralPath $hostsPath -ErrorAction Stop)) {
      $t = $line.Trim()
      if (-not $t -or $t.StartsWith("#")) { continue }
      $parts = $t -split '\s+'
      if ($parts.Count -ge 2 -and $parts[0] -match '^(127\.|::1$)' -and ($parts[1..($parts.Count - 1)] -contains $hostName)) { return $true }
    }
  } catch {}
  return $false
}

function Start-KwalifyTunnel {
  $owned = Find-OwnedTunnel
  if ($owned) { Ok "Cloudflare tunnel already running (PID $($owned.Id))"; return }
  $other = Find-OtherTunnel
  if ($other) {
    Ok "Cloudflare tunnel already running (PID $($other.Id), not started by KWALIFY-START - left as is)"
    return
  }
  if (-not (Test-Path -LiteralPath $TunnelConfig)) {
    Say "  [--] Tunnel not started: deploy\cloudflared.yml is missing (run setup-self-host.bat once)." "Yellow"
    return
  }
  $cf = Find-CloudflaredExe
  if (-not $cf) {
    Say "  [--] Tunnel not started: cloudflared is not installed (run setup-self-host.bat once)." "Yellow"
    return
  }
  $p = Start-Process -FilePath $cf -ArgumentList @("tunnel", "--config", "`"$TunnelConfig`"", "run") `
    -WorkingDirectory $Root -WindowStyle Minimized -PassThru
  Start-Sleep -Seconds 2
  if ($p.HasExited) {
    Problem "cloudflared exited straight away (code $($p.ExitCode)). Kwalify is still running locally."
    Say "       To see why, run in a new window:  cloudflared tunnel --config deploy\cloudflared.yml run" "Yellow"
    return
  }
  @{
    pid           = $p.Id
    startTicksUtc = $p.StartTime.ToUniversalTime().Ticks
    config        = $TunnelConfig
    startedAt     = (Get-Date).ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $TunnelStateFile -Encoding UTF8
  Ok "Cloudflare tunnel started (PID $($p.Id), minimised window)"
}

function Stop-OwnedTunnel {
  $t = Find-OwnedTunnel
  if (-not $t) { return $false }
  $tid = $t.Id
  $null = Send-CtrlC $tid
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Process -Id $tid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  if ((Get-Process -Id $tid -ErrorAction SilentlyContinue) -and (Test-IsKwalifyTunnel $tid)) {
    Stop-Process -Id $tid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process -Id $tid -ErrorAction SilentlyContinue) { return $false }
  Remove-Item -LiteralPath $TunnelStateFile -Force -ErrorAction SilentlyContinue
  return $true
}

function Show-PublicUrlStatus {
  if (-not $env:APP_URL -or ($env:APP_URL -match 'localhost|127\.0\.0\.1')) { return }
  $url = $env:APP_URL.TrimEnd("/")
  $hostName = $null
  try { $hostName = ([Uri]$url).Host } catch {}
  if (Test-HostsPointsLocal $hostName) {
    Say "  Note: this PC's hosts file sends $hostName to 127.0.0.1, so $url will not" "Yellow"
    Say "        reach the tunnel from this PC. Fix once: right-click remove-local-hosts.bat > Run as administrator." "Yellow"
  }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/readyz" -TimeoutSec 6
      if ($r.StatusCode -eq 200) { Say "Public site: $url" "Green"; return }
    } catch {}
    Start-Sleep -Seconds 3
  }
  Say "Public site $url is not answering yet (the tunnel can take a minute to connect)." "Yellow"
}

# --
function Invoke-Start {
  $host.UI.RawUI.WindowTitle = "Kwalify server"
  Set-Location $Root
  Say ""
  Say "Starting Kwalify..." "Cyan"
  Say ""

  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Problem "Node.js / npm not found. Install Node.js 20 LTS from https://nodejs.org, then try again."
    return 1
  }
  $nodeVersion = (& node -v)
  if ($nodeVersion -notmatch '^v20\.') { Say "  Note: Kwalify targets Node 20.x; found $nodeVersion" "Yellow" } else { Ok "Node $nodeVersion" }

  if (-not (Import-KwalifyEnv)) { return 1 }
  $port = Get-Port
  Show-AutostartWarning

  $existing = Find-KwalifyServer $port
  if ($existing) {
    Say ""
    Say "Kwalify is already running (PID $($existing.Id)) - not starting a second copy." "Green"
    Say "http://localhost:$port"
    if (-not (Test-Ready $port)) { Say "  (it is still starting up or not ready yet)" "Yellow" }
    if (Get-TunnelPlan) { Start-KwalifyTunnel }
    Say "To stop it: double-click KWALIFY-STOP.bat"
    return 0
  }

  $owners = Get-PortOwnerIds $port
  if ($owners.Count -gt 0) {
    $names = ($owners | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p) { "$($p.ProcessName) (PID $_)" } else { "PID $_" } }) -join ", "
    Problem "Port $port is already in use by: $names"
    Say "       That is not a Kwalify server started from this folder, so it was left alone." "Yellow"
    Say "       Close that program, or change PORT in .env, then try again." "Yellow"
    return 1
  }

  if (-not (Test-PostgresReachable)) { return 1 }

  if (-not (Test-Path -LiteralPath (Join-Path $Root "node_modules"))) {
    Say "  Installing dependencies (first run only): npm ci" "Cyan"
    & npm ci | Out-Host
    if ($LASTEXITCODE -ne 0) { Problem "npm ci failed (see messages above)."; return 1 }
  }

  if (Test-BuildStale) {
    Say "  Source changed since the last build - building (npm run build)..." "Cyan"
    & npm run build | Out-Host
    if ($LASTEXITCODE -ne 0) { Problem "Build failed (see messages above). Kwalify was not started."; return 1 }
    Ok "Build complete"
  } else {
    Ok "Build is up to date"
  }

  try { $env:GIT_COMMIT = (& git -C $Root rev-parse HEAD 2>$null) } catch {}
  if (-not $env:GIT_COMMIT) { $env:GIT_COMMIT = "local-dev" }

  Say ""
  Say "Starting server (logs below)..." "Cyan"
  $nodeExe = (Get-Command node).Source
  $proc = Start-Process -FilePath $nodeExe -ArgumentList $ServerEntry -WorkingDirectory $Root -NoNewWindow -PassThru
  if (-not (Test-Path -LiteralPath $StateDir)) { New-Item -ItemType Directory -Path $StateDir | Out-Null }
  @{
    pid           = $proc.Id
    startTicksUtc = $proc.StartTime.ToUniversalTime().Ticks
    port          = $port
    root          = $Root
    startedAt     = (Get-Date).ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8

  $exitCode = 0
  try {
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    $ready = $false
    while (-not $proc.HasExited -and (Get-Date) -lt $deadline) {
      if (Test-Ready $port) { $ready = $true; break }
      Start-Sleep -Seconds 2
    }
    if ($proc.HasExited) {
      Say ""
      Problem "Kwalify stopped during startup (exit code $($proc.ExitCode)). See the messages above."
      $exitCode = 1
      return 1
    }
    Say ""
    if ($ready) {
      Say "Kwalify is running" "Green"
      Say "http://localhost:$port" "Green"
    } else {
      $rz = Get-Readiness $port
      $state = if ($rz) { "$($rz.status) / $($rz.readiness)" } else { "no response" }
      Say "Kwalify started but is not ready after $ReadyTimeoutSec s (readyz: $state)." "Yellow"
      Say "http://localhost:$port" "Yellow"
      Say "Check the log messages above." "Yellow"
    }
    if ($ready -and (Get-TunnelPlan)) {
      Say ""
      Start-KwalifyTunnel
      Show-PublicUrlStatus
    } elseif ($env:APP_URL -and ($env:APP_URL -notmatch 'localhost|127\.0\.0\.1')) {
      $why = if ($NoTunnel) { "started with 'local'" } elseif (-not $ready) { "server not ready" } else { "this PC is not set up for self-hosting" }
      Say "  (Cloudflare tunnel not started: $why - only http://localhost:$port works)" "DarkGray"
    }
    Say ""
    Say "Keep this window open. To stop: double-click KWALIFY-STOP.bat (or press Ctrl+C here)." "Cyan"
    Say ""
    while (-not $proc.HasExited) { Start-Sleep -Seconds 1 }
  } finally {
    # Reached on normal exit, on Ctrl+C, or when KWALIFY-STOP.bat sends Ctrl+C.
    if (-not $proc.HasExited) {
      Say ""
      Say "Waiting for Kwalify to shut down gracefully (up to $StopTimeoutSec s)..." "Yellow"
      $proc.WaitForExit($StopTimeoutSec * 1000) | Out-Null
    }
    if ($proc.HasExited) {
      Clear-State $proc.Id
      if (Stop-OwnedTunnel) { Say "Cloudflare tunnel stopped." "Cyan" }
      Say ""
      Say "Kwalify has stopped." "Cyan"
    } else {
      Say "Kwalify is still shutting down (PID $($proc.Id))." "Yellow"
    }
  }
  return $exitCode
}

function Invoke-Stop {
  Set-Location $Root
  Say ""
  Say "Stopping Kwalify..." "Cyan"
  if (-not (Import-KwalifyEnv)) { Say "  Using default port 5000." "Yellow"; $env:PORT = "5000" }
  $port = Get-Port

  $server = Find-KwalifyServer $port
  if (-not $server) {
    Say ""
    Say "Kwalify is not running." "Green"
    $owners = Get-PortOwnerIds $port
    if ($owners.Count -gt 0) {
      Say "  (port $port is used by another program, PID $($owners -join ', '); it was left alone)" "Yellow"
    }
    if (Stop-OwnedTunnel) { Say "  Stopped the Cloudflare tunnel KWALIFY-START had started." "Green" }
    return 0
  }

  $serverId = $server.Id
  Say "  Found Kwalify server (PID $serverId). Asking it to shut down gracefully..."
  Say "  In-flight playlist generations are allowed to finish (up to ~100 s)."
  $sent = Send-CtrlC $serverId
  if (-not $sent) { Say "  Could not send the shutdown signal to its window." "Yellow" }

  $deadline = (Get-Date).AddSeconds($StopTimeoutSec)
  $nextDot = (Get-Date).AddSeconds(5)
  while ((Get-Process -Id $serverId -ErrorAction SilentlyContinue) -and $sent -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ((Get-Date) -ge $nextDot) { Write-Host "  ...still shutting down"; $nextDot = (Get-Date).AddSeconds(5) }
  }

  if (Get-Process -Id $serverId -ErrorAction SilentlyContinue) {
    Say ""
    Problem "Kwalify (PID $serverId) did not stop gracefully."
    $answer = Read-Host "  Force-stop this Kwalify process? Unsaved in-flight work will be lost. (y/N)"
    if ($answer -match '^[yY]') {
      if (Test-IsKwalifyServer $serverId) {
        Stop-Process -Id $serverId -Force
        Start-Sleep -Seconds 1
      }
    } else {
      Say "  Left running." "Yellow"
      return 1
    }
  }

  if (Get-Process -Id $serverId -ErrorAction SilentlyContinue) {
    Problem "Kwalify (PID $serverId) is still running."
    return 1
  }
  Clear-State $serverId
  if (Stop-OwnedTunnel) {
    Say "  Cloudflare tunnel stopped."
  } elseif (Find-OtherTunnel) {
    Say "  A Cloudflare tunnel KWALIFY-START did not start is still running - left alone." "Yellow"
  }
  Say ""
  Say "Kwalify has stopped. (PostgreSQL was not touched.)" "Green"
  return 0
}

if ($Action -eq "start") {
  # Launched with -NoExit by KWALIFY-START.bat so this window stays open (logs and
  # errors remain visible) whether startup fails, the server stops, or Ctrl+C is used.
  $null = Invoke-Start
  Say ""
  Say "You can close this window." "DarkGray"
} else {
  exit (Invoke-Stop)
}
