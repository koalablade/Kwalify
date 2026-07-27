# Launcher API: state, run dispatch, chat interpretation.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$script:LauncherRoot = $Root
$script:LauncherLock = Join-Path $env:TEMP "kwalify-benchmark.lock"
$script:LauncherLog = Join-Path $Root "kwalify-benchmark.log"
$script:LauncherPidFile = Join-Path $Root "reports\.benchmark-launcher.pid"
$script:ApiUpCache = $null
$script:ApiUpCacheAt = [DateTime]::MinValue

. "$PSScriptRoot\benchmark-lib.ps1" -Root $Root
. "$PSScriptRoot\benchmark-ux.ps1" -Root $Root
. "$PSScriptRoot\benchmark-prompt-picker.ps1" -Root $Root
. "$PSScriptRoot\benchmark-quick-run.ps1" -Root $Root

function Rotate-OversizedLauncherLog {
  if (-not (Test-Path -LiteralPath $script:LauncherLog)) { return }
  try {
    $mb = (Get-Item -LiteralPath $script:LauncherLog).Length / 1MB
    if ($mb -le 3) { return }
    $rotated = "$script:LauncherLog.old"
    if (Test-Path -LiteralPath $rotated) { Remove-Item -LiteralPath $rotated -Force }
    Move-Item -LiteralPath $script:LauncherLog -Destination $rotated -Force
  } catch {}
}

Rotate-OversizedLauncherLog

function Clear-StaleBenchmarkLock {
  if (-not (Test-Path -LiteralPath $script:LauncherLock)) { return $false }
  try {
    $fs = [System.IO.File]::Open($script:LauncherLock, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $fs.Dispose()
    Remove-Item -LiteralPath $script:LauncherLock -Force -ErrorAction SilentlyContinue
    return $true
  } catch {
    $age = ((Get-Date) - (Get-Item -LiteralPath $script:LauncherLock).LastWriteTime).TotalHours
    if ($age -gt 2) {
      try {
        Remove-Item -LiteralPath $script:LauncherLock -Force
        return $true
      } catch {}
    }
    return $false
  }
}

function Test-BenchmarkRunning {
  Clear-StaleBenchmarkLock | Out-Null
  if (-not (Test-Path -LiteralPath $script:LauncherLock)) { return $false }
  try {
    $fs = [System.IO.File]::Open($script:LauncherLock, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $fs.Dispose()
    return $false
  } catch { return $true }
}

function Start-BenchmarkProcess {
  param(
    [string]$Request = "",
    [string]$Suite = "",
    [switch]$RepeatLast
  )

  $windowScript = Join-Path $script:LauncherRoot "scripts\spawn-benchmark-window.ps1"
  if (-not (Test-Path -LiteralPath $windowScript)) {
    throw "Missing spawn script: $windowScript"
  }

  $spawnArgs = @()
  if ($RepeatLast) { $spawnArgs += "-RepeatLast" }
  elseif ($Suite) { $spawnArgs += @("-Suite", $Suite) }
  elseif ($Request) { $spawnArgs += @("-Request", $Request) }
  else { throw "Nothing to run - no suite or request." }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $windowScript @spawnArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $statusPath = Join-Path $script:LauncherRoot "reports\benchmark-last-spawn.json"
    $err = "Could not start benchmark window."
    if (Test-Path -LiteralPath $statusPath) {
      try {
        $st = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        if ($st.error) { $err = [string]$st.error }
      } catch {}
    }
    throw $err
  }
}

function Get-LauncherLiveState {
  $livePath = Join-Path $script:LauncherRoot "reports\benchmark-live.json"
  if (-not (Test-Path -LiteralPath $livePath)) { return $null }
  try { return Get-Content -LiteralPath $livePath -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-LauncherHistoryPreview {
  $path = Join-Path $script:LauncherRoot "reports\benchmark-history.json"
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  try {
    $rows = @(Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
    return @($rows | Select-Object -First 5)
  } catch { return @() }
}

function Get-LauncherLogTail {
  param([int]$Lines = 20)
  if (-not (Test-Path -LiteralPath $script:LauncherLog)) { return @() }
  try {
    $sizeMb = (Get-Item -LiteralPath $script:LauncherLog).Length / 1MB
    if ($sizeMb -gt 5) {
      return @("(log is $([math]::Round($sizeMb))MB - tail skipped for speed)")
    }
    $fs = [System.IO.File]::Open(
      $script:LauncherLog,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::ReadWrite
    )
    try {
      $reader = New-Object System.IO.StreamReader($fs)
      $all = [System.Collections.Generic.List[string]]::new()
      while ($null -ne ($line = $reader.ReadLine())) {
        $all.Add($line) | Out-Null
      }
      if ($all.Count -le $Lines) { return @($all) }
      return @($all.GetRange($all.Count - $Lines, $Lines))
    } finally {
      $fs.Dispose()
    }
  } catch { return @() }
}

function Get-CachedApiUp([string]$Url) {
  $age = ((Get-Date) - $script:ApiUpCacheAt).TotalSeconds
  if ($null -ne $script:ApiUpCache -and $age -lt 20) { return $script:ApiUpCache }
  $script:ApiUpCache = Test-ApiRunning $Url
  $script:ApiUpCacheAt = Get-Date
  return $script:ApiUpCache
}

function Get-LauncherPing {
  return @{
    ok = $true
    launcherVersion = "2"
    url = "/benchmark"
  }
}

function Get-LauncherState {
  $apiUrl = "http://127.0.0.1:5000"
  $apiUp = Get-CachedApiUp $apiUrl
  $live = Get-LauncherLiveState
  $last = Get-BenchmarkLastChoice
  $saved = Get-SavedBenchmarkPresets
  $history = Get-LauncherHistoryPreview
  $running = Test-BenchmarkRunning
  $stuckPath = Join-Path $script:LauncherRoot "reports\benchmark-stuck-warning.txt"
  $stuck = $null
  if (Test-Path -LiteralPath $stuckPath) {
    try { $stuck = Get-Content -LiteralPath $stuckPath -Raw } catch {}
  }

  return @{
    apiUp = $apiUp
    apiUrl = $apiUrl
    benchmarkRunning = $running
    live = $live
    lastChoice = $last
    savedPresets = $saved
    history = $history
    logTail = Get-LauncherLogTail -Lines 15
    stuckWarning = $stuck
    launcherVersion = "2"
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
}

function Convert-LauncherStateJson([hashtable]$State) {
  return ($State | ConvertTo-Json -Depth 12 -Compress)
}

function Get-LauncherButtonPresets {
  return @(
    @{ id = "go"; label = "Go now"; sub = "50 human - ~2h"; suite = "go"; primary = $true }
    @{ id = "smoke"; label = "Quick check"; sub = "1 prompt - ~2 min"; suite = "smoke" }
    @{ id = "small"; label = "Small"; sub = "25 prompts - ~1h"; suite = "small" }
    @{ id = "medium"; label = "Medium"; sub = "50 prompts - ~2h"; suite = "medium" }
    @{ id = "long"; label = "Long"; sub = "100 prompts - ~4h"; suite = "long" }
    @{ id = "mix50"; label = "Full mix 50"; sub = "genre-lock included"; suite = "mix-medium" }
    @{ id = "easy25"; label = "Easy 25"; sub = "sanity check"; request = "25 easy yes" }
    @{ id = "repeat"; label = "Repeat last"; sub = "same preset - fresh prompts"; action = "repeat" }
    @{ id = "package"; label = "Package zip"; sub = "latest to Desktop"; suite = "package" }
    @{ id = "status"; label = "Open live"; sub = "progress dashboard"; action = "open-status" }
  )
}

function Resolve-LauncherRunTarget {
  param([string]$Request = "", [string]$Suite = "")
  if ($Suite -eq "repeat") { return @{ RepeatLast = $true } }
  if ($Suite) { return @{ Suite = $Suite } }

  $text = $Request.Trim()
  $core = ($text -replace '\b(yes|go|now)\b', '').Trim()
  $known = @(
    "smoke", "status", "package", "guide", "history", "go", "recommended",
    "eval-10", "eval-50", "eval-100", "reliability", "reliability-human",
    "opening", "6h", "pairwise", "overnight",
    "mix-small", "mix-medium", "mix-long",
    "tier-easy", "tier-medium", "tier-hard", "tier-edge",
    "small", "medium", "long", "large", "full"
  )
  foreach ($s in $known) {
    if ($core -eq $s) { return @{ Suite = $s } }
  }
  return @{ Request = $Request }
}

function Invoke-LauncherRun {
  param(
    [string]$Request = "",
    [string]$Suite = "",
    [switch]$DryRun
  )

  if (Test-BenchmarkRunning) {
    return @{ ok = $false; error = "A benchmark is already running. If it crashed, click Clear stuck lock below." }
  }

  $target = Resolve-LauncherRunTarget -Request $Request -Suite $Suite

  if ($DryRun) {
    $previewLabel = if ($target.Suite) { $target.Suite } else { $Request }
    return @{ ok = $true; dryRun = $true; preview = @{ label = $previewLabel }; message = "Preview OK" }
  }

  try {
    Start-BenchmarkProcess @target
  } catch {
    return @{ ok = $false; error = "Could not start benchmark: $($_.Exception.Message). See reports\benchmark-spawn.log" }
  }

  $preview = $null
  if ($target.Request -and $target.Request -notmatch '^(smoke|status|package)') {
    $parsed = Parse-NaturalBenchmarkRequest -Request ($target.Request -replace '\s+yes\s*$', '').Trim()
    if ($parsed) { $preview = @{ label = $parsed.label } }
  } elseif ($target.Suite) {
    $preview = @{ label = $target.Suite }
  }

  $spawnPid = $null
  $statusPath = Join-Path $script:LauncherRoot "reports\benchmark-last-spawn.json"
  if (Test-Path -LiteralPath $statusPath) {
    try {
      $st = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
      if ($st.pid) { $spawnPid = [int]$st.pid }
    } catch {}
  }

  return @{
    ok = $true
    request = $Request
    suite = $Suite
    preview = $preview
    pid = $spawnPid
    message = "Benchmark started - look for a PowerShell window titled Kwalify Benchmark RUN on your PC."
  }
}

function Invoke-LauncherChat {
  param(
    [string]$Message,
    [switch]$ForceRun
  )

  $text = $Message.Trim()
  if (-not $text) {
    return @{ ok = $false; error = "Type a request, e.g. '40 human' or 'run 30 mix'" }
  }

  $dry = $false
  if ($text -match '^(preview|dry|dryrun)\s+') {
    $dry = $true
    $text = ($text -replace '^(preview|dry|dryrun)\s+', '').Trim()
  }

  $lower = $text.ToLower()
  if ($lower -in @("help", "?", "commands")) {
    return @{
      ok = $true
      reply = @"
Try: **40 human** · **30 mix** · **25 easy** · **40 6,15,12,7** (tier split) · **h03,h12** (fixed IDs) · **weekly** (saved preset). Add **go** or **yes** to start immediately. Prefix **preview** to test without running.
"@
      examples = @("40 human go", "preview 50 mix", "repeat last", "smoke")
    }
  }

  if ($lower -match '^(repeat|again|same preset|last)') {
    if ($dry) {
      return @{ ok = $true; reply = "Would repeat last preset with fresh prompt rotation." }
    }
    $run = Invoke-LauncherRun -Suite "repeat"
    return @{ ok = $run.ok; reply = $run.message; run = $run; error = $run.error }
  }

  if ($lower -match '^(save|name)\s+(\S+)\s+(.+)$') {
    return @{ ok = $true; reply = "To save a preset, run it from Quick Run wizard menu, or use CLI after a run." }
  }

  $request = $text
  if ($request -notmatch '\b(yes|go|now|run)\b') { $request = "$request yes" }

  $parsed = Parse-NaturalBenchmarkRequest -Request ($request -replace '\s+yes\s*$', '').Trim()
  if (-not $parsed) {
    return @{
      ok = $false
      reply = "I didn't understand that. Try: 40 human · 30 mix · 25 easy · h03,h12 · or type help"
    }
  }

  $resolved = Resolve-BenchmarkPromptSelection -Cfg @{
    limit = [int]$parsed.limit
    presetKey = $parsed.presetKey
    humanOnly = [bool]$parsed.humanOnly
    fullMix = [bool]$parsed.fullMix
    freezeIds = [bool]$parsed.freezeIds
    cohort = $parsed.cohort
    difficulty = $parsed.difficulty
    tierMix = $parsed.tierMix
    ids = $parsed.ids
    variety = $true
  }

  $reply = "I'll run **$($parsed.label)** ($($resolved.limit) prompts). $($resolved.rotationNote)"
  # Chat box + Run button = start immediately unless user asked for preview/dry only.
  $shouldRun = $ForceRun -or $dry -or ($request -match '\b(yes|go|now|run)\b')

  if ($shouldRun -and -not $dry) {
    $run = Invoke-LauncherRun -Request $request
    return @{ ok = $run.ok; reply = $reply; run = $run; error = $run.error }
  }

  if ($dry) {
    $run = Invoke-LauncherRun -Request $request -DryRun
    return @{ ok = $true; reply = "$reply (preview only)"; run = $run }
  }

  return @{
    ok = $true
    reply = "$reply - add **go** to start, or click Run below."
    parsed = @{ label = $parsed.label; limit = $resolved.limit; request = $request }
    suggestRun = $request
  }
}
