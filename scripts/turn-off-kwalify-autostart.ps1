# One-time cleanup: remove everything that makes Kwalify run on its own.
#
# Removes (only things that are clearly Kwalify's):
#   - scheduled tasks: Kwalify-SelfHost-Start (logon), Kwalify-Uptime-Check (5 min),
#     Kwalify-Weekly-Maintenance (Sundays), Kwalify-Daily-DB-Backup (3am), and any
#     other scheduled task whose action points into this Kwalify folder
#   - Windows Startup-folder shortcuts that point into this Kwalify folder
#   - a running Kwalify health-watch watchdog (the one that restarts the API/tunnel)
#
# Does NOT touch: PostgreSQL, the database, a running Kwalify server, Cloudflare
# services, or anything else. Reports what it finds and what it changed.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$KwalifyTaskNames = @("Kwalify-SelfHost-Start", "Kwalify-Uptime-Check", "Kwalify-Weekly-Maintenance", "Kwalify-Daily-DB-Backup")
$changed = 0
$problems = 0

function Points-IntoKwalify([string]$text) {
  return [bool]($text -and $text.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0)
}

Write-Host ""
Write-Host "Turning off Kwalify auto-start..." -ForegroundColor Cyan
Write-Host "  Kwalify folder: $Root"
Write-Host ""

# 1. Scheduled tasks
Write-Host "Scheduled tasks:"
$tasks = @()
try {
  foreach ($t in (Get-ScheduledTask -ErrorAction Stop)) {
    $actionText = (($t.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -join " ")
    if (($KwalifyTaskNames -contains $t.TaskName) -or (Points-IntoKwalify $actionText)) { $tasks += $t }
  }
} catch {
  Write-Host "  Could not read Task Scheduler: $($_.Exception.Message)" -ForegroundColor Yellow
  $problems++
}
if ($tasks.Count -eq 0) { Write-Host "  none found" -ForegroundColor Green }
foreach ($t in $tasks) {
  try {
    Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Confirm:$false -ErrorAction Stop
    Write-Host "  removed: $($t.TaskName)" -ForegroundColor Green
    $changed++
    if ($t.TaskName -eq "Kwalify-Daily-DB-Backup") {
      Write-Host "    (automatic nightly database backups are now off; run backup-db when you want one)" -ForegroundColor DarkGray
    }
  } catch {
    Write-Host "  could not remove $($t.TaskName): $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "    -> right-click TURN-OFF-AUTOSTART.bat and choose 'Run as administrator'" -ForegroundColor Yellow
    $problems++
  }
}

# 2. Startup-folder shortcuts pointing at Kwalify
Write-Host ""
Write-Host "Startup folder shortcuts:"
$startupDirs = @([Environment]::GetFolderPath("Startup"), [Environment]::GetFolderPath("CommonStartup")) | Where-Object { $_ }
$shell = $null
try { $shell = New-Object -ComObject WScript.Shell } catch {}
$foundLinks = 0
foreach ($dir in $startupDirs) {
  if (-not (Test-Path -LiteralPath $dir)) { continue }
  foreach ($item in (Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue)) {
    $target = ""
    if ($item.Extension -ieq ".lnk" -and $shell) {
      try { $lnk = $shell.CreateShortcut($item.FullName); $target = "$($lnk.TargetPath) $($lnk.Arguments) $($lnk.WorkingDirectory)" } catch {}
    } elseif ($item.Extension -match '^\.(bat|cmd|ps1|vbs)$') {
      try { $target = Get-Content -LiteralPath $item.FullName -Raw -ErrorAction Stop } catch {}
    }
    if (-not (Points-IntoKwalify $target)) { continue }
    $foundLinks++
    try {
      Remove-Item -LiteralPath $item.FullName -Force -ErrorAction Stop
      Write-Host "  removed: $($item.FullName)" -ForegroundColor Green
      $changed++
    } catch {
      Write-Host "  could not remove $($item.FullName): $($_.Exception.Message)" -ForegroundColor Yellow
      $problems++
    }
  }
}
if ($foundLinks -eq 0) { Write-Host "  none found" -ForegroundColor Green }

# 3. Health-watch watchdog (restarts the API/tunnel when it thinks they are down)
Write-Host ""
Write-Host "Background watchdog:"
$watchers = @()
try {
  $watchers = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'watch-local-health\.ps1' })
} catch {}
if ($watchers.Count -eq 0) { Write-Host "  not running" -ForegroundColor Green }
foreach ($w in $watchers) {
  try {
    Stop-Process -Id $w.ProcessId -Force -ErrorAction Stop
    Write-Host "  stopped health watch (PID $($w.ProcessId))" -ForegroundColor Green
    $changed++
  } catch {
    Write-Host "  could not stop health watch PID $($w.ProcessId): $($_.Exception.Message)" -ForegroundColor Yellow
    $problems++
  }
}
$watchPid = Join-Path $Root "reports\.kwalify-watchdog.pid"
if (Test-Path -LiteralPath $watchPid) { Remove-Item -LiteralPath $watchPid -Force -ErrorAction SilentlyContinue }

# 4. Report-only: services that may start at boot (not changed by this script)
Write-Host ""
Write-Host "Services (report only, not changed):"
$svcs = @(Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'cloudflared|kwalify' -or $_.DisplayName -match 'cloudflared|kwalify' })
if ($svcs.Count -eq 0) { Write-Host "  no Kwalify or Cloudflare tunnel service installed" -ForegroundColor Green }
foreach ($s in $svcs) {
  $startType = ""
  try { $startType = (Get-CimInstance Win32_Service -Filter "Name = '$($s.Name)'").StartMode } catch {}
  Write-Host "  $($s.Name): $($s.Status), start mode $startType" -ForegroundColor Yellow
  Write-Host "    If you want it off at boot: services.msc -> $($s.DisplayName) -> Startup type: Manual" -ForegroundColor Yellow
}

Write-Host ""
if ($problems -gt 0) {
  Write-Host "Finished with $problems problem(s) - see above." -ForegroundColor Yellow
} else {
  Write-Host "Done. Kwalify will only run when you double-click local\START.bat." -ForegroundColor Green
}
Write-Host "(PostgreSQL and your database were not touched.)" -ForegroundColor DarkGray
exit 0
