# Kwalify benchmark launcher - one tool, no faffing.
# Desktop: Run Benchmark  |  Project: start-kwalify-benchmark.bat
param(
  [string]$Suite = "",
  [int]$Limit = 0,
  [string]$Group = "",
  [string]$BaseUrl = "",
  [switch]$Production,
  [switch]$SpawnLocal,
  [switch]$Resume,
  [switch]$DryRun,
  [switch]$SkipBuild,
  [switch]$SkipPreflight,
  [switch]$NoMenu,
  [switch]$Variety,
  [switch]$Package,
  [string]$PromptIds = "",
  [string]$Cohort = "",
  [string]$DifficultyFilter = "",
  [string]$Request = "",
  [switch]$RepeatLast,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. "$PSScriptRoot\benchmark-lib.ps1" -Root $root
. "$PSScriptRoot\benchmark-ux.ps1" -Root $root

$logPath = Join-Path $root "kwalify-benchmark.log"
$lockPath = Join-Path $env:TEMP "kwalify-benchmark.lock"
$transcriptStarted = $false
$lockStream = $null
$runStartedAt = Get-Date
$lastReportPaths = @()
$script:BenchmarkRunId = New-BenchmarkRunId
$script:BenchmarkRunState = $null
$script:LogTailShown = $false
$script:MenuPage = 1
$script:HumanKeepIds = ""
$script:HumanKeepCohort = ""
$script:HumanKeepDifficulty = ""
$script:RunLabel = ""
$script:MenuChoice = @{}
$script:RotationNote = ""

. "$PSScriptRoot\benchmark-prompt-picker.ps1" -Root $root
. "$PSScriptRoot\benchmark-quick-run.ps1" -Root $root

function Step([string]$msg) { Write-Host ""; Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "  $msg" -ForegroundColor Green }
function Write-WarnLine([string]$msg) { Write-Host "  $msg" -ForegroundColor Yellow }
function Write-ErrLine([string]$msg) { Write-Host "  $msg" -ForegroundColor Red }

function Show-LogTail {
  if ($script:LogTailShown) { return }
  $script:LogTailShown = $true
  if (-not (Test-Path -LiteralPath $logPath)) { return }
  Write-Host ""; Write-Host "  --- last 15 log lines ---" -ForegroundColor DarkGray
  Get-Content -LiteralPath $logPath -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_ -notmatch '--- last \d+ log lines ---') { Write-Host "  $_" -ForegroundColor DarkGray }
  }
}

function Show-ReportHints {
  if ($lastReportPaths.Count -eq 0) { return }
  Write-Host ""; Write-Host "  Reports:" -ForegroundColor Cyan
  foreach ($p in $lastReportPaths | Select-Object -Unique) {
    if (Test-Path -LiteralPath $p) { Write-Host "    $p" }
  }
}

function Open-BenchmarkGuide {
  $html = Join-Path $root "frontend\public\benchmark-guide.html"
  if (Test-Path -LiteralPath $html) {
    Start-Process $html | Out-Null
    return $true
  }
  return $false
}

function Open-BenchmarkHistory {
  $html = Join-Path $root "frontend\public\benchmark-history.html"
  if (Test-Path -LiteralPath $html) {
    Start-Process $html | Out-Null
    return $true
  }
  return $false
}

function Open-BenchmarkStatusPage {
  $html = Join-Path $root "frontend\public\benchmark-status.html"
  if (Test-Path -LiteralPath $html) {
    Start-Process $html | Out-Null
    return $true
  }
  return $false
}

function Open-ReportsFolder {
  $reports = Join-Path $root "reports"
  if (Test-Path -LiteralPath $reports) { Start-Process explorer.exe $reports | Out-Null }
}

function Exit-Benchmark([int]$code, [string]$reason) {
  if ($code -ne 0 -and $reason) {
    Write-Host ""; Write-ErrLine $reason
    Write-Host "  Full log: $logPath" -ForegroundColor DarkYellow
    Show-LogTail; Show-ReportHints
  } elseif ($code -eq 0) { Show-ReportHints }
  if ($lockStream) { try { $lockStream.Dispose() } catch {} }
  if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
  exit $code
}

function Rotate-Log {
  if (-not (Test-Path -LiteralPath $logPath)) { return }
  if (((Get-Item -LiteralPath $logPath).Length / 1MB) -gt 3) {
    $rotated = "$logPath.old"
    if (Test-Path -LiteralPath $rotated) { Remove-Item -LiteralPath $rotated -Force }
    Move-Item -LiteralPath $logPath -Destination $rotated -Force
  }
}

function Acquire-Lock {
  try {
    $script:lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch {
    Exit-Benchmark 1 "Another benchmark is running. Delete $lockPath if stuck."
  }
}

function Show-Help {
  Write-Host ""
  Write-Host "HUMAN PROMPT BENCHMARK" -ForegroundColor Magenta
  Write-Host ""
  Write-Host "EASIEST (like asking an assistant)"
  Write-Host "  (open menu, press Enter)     Quick Run wizard - all options, smart defaults"
  Write-Host "  go yes                       50 human-only, rotates, no questions"
  Write-Host "  run 40 human yes             natural language - count + style + go"
  Write-Host "  run 30 mix yes               full mix, 30 prompts"
  Write-Host "  run 40 8,12,8,2 yes          custom tier split (easy,med,hard,edge)"
  Write-Host "  run h03,h12 yes              fixed prompt IDs"
  Write-Host "  run weekly yes               saved preset by name"
  Write-Host ""
  Write-Host "SIZES (human-only by default)"
  Write-Host "  small / medium / long yes    25 / 50 / 100, rotates each run"
  Write-Host ""
  Write-Host "FULL MIX (genre-lock prompts included)"
  Write-Host "  mix-small yes / mix-medium yes / mix-long yes"
  Write-Host ""
  Write-Host "TOOLS:  smoke   status   package   history   menu"
  Write-Host "MORE:   eval, reliability, 6h, tiers (menu [m])"
  Write-Host ""
}

function Get-FullMixPreset([int]$Total, [string]$Label) {
  return @{
    suite = "human"; limit = $Total; variety = $true; fullMix = $true; noMenu = $true
    presetKey = "full-mix-$Total"
    label = "Full mix $Label ($Total) [rotates each run]"
  }
}

function Get-HumanOnlyPreset([int]$Total, [string]$Label) {
  return @{
    suite = "human"; limit = $Total; variety = $true; humanOnly = $true; noMenu = $true
    presetKey = "human-only-$Total"
    label = "Human only $Label ($Total) [rotates each run]"
  }
}

function Get-LongRunPreset() {
  $preset = Get-HumanOnlyPreset -Total 100 -Label "long"
  $preset.spawnLocal = $true
  $preset.package = $true
  return $preset
}

function Apply-SuitePresets([string]$name) {
  switch ($name) {
    { $_ -in @("large", "long", "full") } {
      Write-Host "  LONG RUN: 100 human-only prompts, variety mix, auto API + zip." -ForegroundColor Cyan
      return Get-LongRunPreset
    }
    "small" { return (Get-HumanOnlyPreset -Total 25 -Label "small") }
    "medium" { return (Get-HumanOnlyPreset -Total 50 -Label "medium") }
    "mix-small" { return (Get-FullMixPreset -Total 25 -Label "small") }
    "mix-medium" { return (Get-FullMixPreset -Total 50 -Label "medium") }
    { $_ -in @("mix-long", "mix-large", "mix-full") } {
      $p = Get-FullMixPreset -Total 100 -Label "long"
      $p.spawnLocal = $true; $p.package = $true
      return $p
    }
    "overnight" { return @{ suite = "human-saveability-overnight" } }
    default { return @{ suite = $name } }
  }
}

function Invoke-PromptPickerForSize {
  param([int]$Size)
  $menuPick = Show-PromptPickerMenu -Size $Size
  if (-not $menuPick) { return $false }
  Apply-MenuConfig $menuPick
  $script:SuiteFromPicker = $menuPick.suite
  if ($script:LimitFromMenu) { $script:Limit = $script:LimitFromMenu }
  if ($script:VarietyFromMenu) { $script:Variety = $true }
  if ($script:PackageFromMenu) { $script:Package = $true }
  return $true
}

function Get-MenuPage2 {
  return @(
    @{ Key = "b"; Id = "_back"; Name = "Back to main menu"; Detail = ""; Est = "" }
    @{ Key = "11"; Id = "human-quick"; Name = "Human quick sample"; Detail = "15 mixed human prompts"; Est = "~35 min" }
    @{ Key = "12"; Id = "reliability"; Name = "Golden reliability"; Detail = "CI golden prompts (~25)"; Est = "~45 min" }
    @{ Key = "13"; Id = "reliability-human"; Name = "Reliability: human-language"; Detail = "Golden human subset (~5)"; Est = "~10 min" }
    @{ Key = "14"; Id = "opening"; Name = "Opening curator v2"; Detail = "First-track editorial (31)"; Est = "~60 min" }
    @{ Key = "15"; Id = "eval-10"; Name = "Eval harness (10)"; Detail = "Stratified eval sample"; Est = "~20 min" }
    @{ Key = "16"; Id = "eval-50"; Name = "Eval harness (50)"; Detail = ""; Est = "~90 min" }
    @{ Key = "17"; Id = "eval-100"; Name = "Eval harness (100)"; Detail = ""; Est = "~3 h" }
    @{ Key = "18"; Id = "6h"; Name = "Live 6h (250)"; Detail = "Overnight-scale"; Est = "4-6 h" }
    @{ Key = "19"; Id = "pairwise"; Name = "Pairwise human"; Detail = "Head-to-head judge"; Est = "~2 h" }
    @{ Key = "20"; Id = "overnight"; Name = "Saveability overnight"; Detail = "Overnight suite"; Est = "hours" }
    @{ Key = "21"; Id = "mix-small"; Name = "Full mix small (25)"; Detail = "Includes genre-lock prompts"; Est = "~1 h" }
    @{ Key = "22"; Id = "mix-medium"; Name = "Full mix medium (50)"; Detail = "Includes genre-lock prompts"; Est = "~2 h" }
    @{ Key = "23"; Id = "mix-long"; Name = "Full mix long (100)"; Detail = "Includes genre-lock prompts"; Est = "~4 h" }
    @{ Key = "31"; Id = "tier-easy"; Name = "By difficulty: easy"; Detail = "All easy tier (~12)"; Est = "~25 min" }
    @{ Key = "32"; Id = "tier-medium"; Name = "By difficulty: medium"; Detail = "All medium tier (~38)"; Est = "~75 min" }
    @{ Key = "33"; Id = "tier-hard"; Name = "By difficulty: hard"; Detail = "All hard tier (~30)"; Est = "~90 min" }
    @{ Key = "34"; Id = "tier-edge"; Name = "By difficulty: edge"; Detail = "All edge tier (~20)"; Est = "~60 min" }
  )
}

function Show-AdvancedMenu {
  Write-Host ""; Write-Host "  MORE BENCHMARKS (b = back)" -ForegroundColor Yellow
  Write-Host "  Not the default human-only flow unless noted." -ForegroundColor DarkGray
  foreach ($s in Get-MenuPage2) {
    $est = if ($s.Est) { " [$($s.Est)]" } else { "" }
    Write-Host ("  {0}. {1}{2}" -f $s.Key.PadLeft(2), $s.Name, $est)
  }
  Write-Host ""
  $choice = (Read-Host "  Your choice").Trim().ToLower()
  if ($choice -eq "b") { return "" }
  foreach ($s in Get-MenuPage2) {
    if ($s.Key -eq $choice -or $s.Id -eq $choice) {
      if ($s.Id -eq "_back") { return "" }
      return $s.Id
    }
  }
  return $choice
}

function Apply-MenuConfig([hashtable]$cfg) {
  if (-not $cfg) { return }
  $script:MenuChoice = @{}
  foreach ($k in $cfg.Keys) { $script:MenuChoice[$k] = $cfg[$k] }
  if ($cfg.suite) { $script:SuiteFromMenu = $cfg.suite }
  if ($cfg.label) { $script:RunLabel = $cfg.label }
  if ($cfg.limit) { $script:LimitFromMenu = [int]$cfg.limit }
  if ($cfg.ids -and $cfg.freezeIds) { $script:HumanKeepIds = $cfg.ids }
  if ($cfg.cohort) { $script:HumanKeepCohort = $cfg.cohort }
  if ($cfg.difficulty) { $script:HumanKeepDifficulty = $cfg.difficulty }
  if ($cfg.variety) { $script:VarietyFromMenu = $true }
  if ($cfg.package) { $script:PackageFromMenu = $true }
  if ($cfg.spawnLocal) { $script:SpawnLocalFromMenu = $true }
  if ($cfg.noMenu) { $script:NoMenuFromMenu = $true }
}

function Confirm-Run([string]$suiteId, [hashtable]$meta) {
  if ($NoMenu) { return $true }
  Write-Host ""; Write-Host "  Ready: $suiteId" -ForegroundColor Cyan
  foreach ($k in $meta.Keys | Sort-Object) { Write-Host ("    {0}: {1}" -f $k, $meta[$k]) }
  $ans = Read-Host "  Continue? [Y/n]"
  if (-not $ans) { return $true }
  return ($ans.Trim().ToLower() -notin @("n", "no"))
}

function Test-BuildStale {
  $dist = Join-Path $root "backend\dist\server.js"
  if (-not (Test-Path -LiteralPath $dist)) { return $true }
  $distTime = (Get-Item -LiteralPath $dist).LastWriteTimeUtc
  foreach ($marker in @("package.json", "package-lock.json")) {
    $p = Join-Path $root $marker
    if ((Test-Path $p) -and (Get-Item $p).LastWriteTimeUtc -gt $distTime) { return $true }
  }
  return $false
}

function Ensure-Build {
  if ($SkipBuild) { Write-WarnLine "Skipping build"; return }
  $dist = Join-Path $root "backend\dist\server.js"
  if (-not (Test-Path $dist) -or (Test-BuildStale)) {
    Step "Building backend"
    npm run build
    if ($LASTEXITCODE -ne 0) { Exit-Benchmark $LASTEXITCODE "npm run build failed." }
    Write-Ok "Build OK"
  } else { Write-Ok "Build up to date" }
}

function Get-ResolvedBaseUrl {
  if ($BaseUrl) { return $BaseUrl.TrimEnd("/") }
  if ($Production) { return "https://kwalify.net" }
  return "http://127.0.0.1:5000"
}

function Get-DeployedCommit([string]$url) {
  try {
    $rz = Invoke-RestMethod -Uri "$url/api/readyz" -TimeoutSec 12
    if ($rz.commit) { return [string]$rz.commit }
  } catch {}
  try {
    $ping = Invoke-RestMethod -Method Post -Uri "$url/api/eval/ping" -Headers @{ "x-kwalify-evaluation-token" = $env:PLAYLIST_EVAL_TOKEN } -TimeoutSec 15
    if ($ping.commit) { return [string]$ping.commit }
  } catch {}
  try { return (git -C $root rev-parse HEAD 2>$null) } catch { return $null }
}

function Ensure-Preflight([string]$url) {
  if ($SkipPreflight -or $DryRun) { return }
  Step "Preflight API + eval token"
  try {
    & (Join-Path $PSScriptRoot "preflight-api.ps1") -BaseUrl $url
    Write-Ok "Preflight passed"
  } catch {
    if ($SpawnLocal -and -not $Production) { Write-WarnLine "Preflight skipped - will auto-start API"; return }
    Exit-Benchmark 1 "API preflight failed at $url"
  }
}

function Ensure-BenchmarkEnv {
  if ($DryRun) { return }
  Step "Validating benchmark environment"
  $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  $out = & npm run validate:benchmark-env 2>&1; $code = $LASTEXITCODE; $ErrorActionPreference = $prev
  if ($code -ne 0) {
    $out | Select-Object -Last 10 | ForEach-Object { Write-ErrLine $_ }
    Exit-Benchmark $code "Benchmark env validation failed."
  }
  Write-Ok "Benchmark env OK"
}

function Invoke-NpmNode {
  param([string[]]$NodeArgs, [hashtable]$EnvExtra = @{}, [string]$Label = "benchmark")
  foreach ($k in $EnvExtra.Keys) { Set-Item -Path "env:$k" -Value $EnvExtra[$k] }
  Write-Host "  node $($NodeArgs -join ' ')" -ForegroundColor DarkCyan
  $started = Get-Date; & node @NodeArgs; $code = $LASTEXITCODE
  $min = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
  if ($code -eq 0) { Write-Ok "$Label done ($min min)" } else { Write-ErrLine "$Label failed ($min min, exit $code)" }
  return $code
}

function Invoke-NpmScript {
  param([string]$ScriptName, [string[]]$ExtraArgs = @(), [hashtable]$EnvExtra = @{}, [string]$Label = $ScriptName)
  foreach ($k in $EnvExtra.Keys) { Set-Item -Path "env:$k" -Value $EnvExtra[$k] }
  Write-Host "  npm run $ScriptName" -ForegroundColor DarkCyan
  $started = Get-Date
  $livePath = Join-Path $root "reports\benchmark-live.json"
  $stuckWarn = Join-Path $root "reports\benchmark-stuck-warning.txt"
  Start-BenchmarkStuckWatch -StatusFile $livePath
  $job = Start-Job -ScriptBlock { param($s, $w) while ($true) { Start-Sleep 5; if (Test-Path $w) { break } }; return (Test-Path $w) } -ArgumentList $livePath, $stuckWarn
  if ($ExtraArgs.Count -gt 0) { & npm run $ScriptName -- @ExtraArgs } else { & npm run $ScriptName }
  $code = $LASTEXITCODE
  Stop-Job $job -ErrorAction SilentlyContinue
  if ((Receive-Job $job) -and (Test-Path $stuckWarn)) {
    Write-Host ""
    Write-WarnLine (Get-Content $stuckWarn -Raw)
    Write-Host "  Open benchmark-status.html to check progress"
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  Stop-BenchmarkStuckWatch
  $min = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
  if ($code -eq 0) { Write-Ok "$Label done ($min min)" } else { Write-ErrLine "$Label failed ($min min, exit $code)" }
  return $code
}

function Find-LatestReport([string]$pattern) {
  $dir = Join-Path $root "reports"
  if (-not (Test-Path $dir)) { return @() }
  Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like $pattern -and $_.LastWriteTime -ge $runStartedAt.AddMinutes(-1) } |
    Sort-Object LastWriteTime -Descending | Select-Object -ExpandProperty FullName
}

function Run-Suite {
  param([string]$Id, [string]$Url, [string]$Commit, [string]$User, [string]$Token)
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $outReliability = "reports/prompt-reliability/local-$stamp"
  $outEval = "reports/playlist-evaluation/local-$stamp"

  switch ($Id) {
    "status" { Show-BenchmarkStatus; return 0 }
    "package" {
      try {
        $zip = Package-BenchmarkRun
        Write-Ok "Created: $zip"
        Start-Process explorer.exe "/select,$zip" | Out-Null
        return 0
      } catch { Write-ErrLine $_.Exception.Message; return 1 }
    }
    "smoke" {
      Ensure-Preflight $Url
      if ($DryRun) { Write-Ok "Dry run smoke"; return 0 }
      $escapedUrl = $Url.Replace("'", "\'")
      $nodeLines = @(
        "const token = process.env.PLAYLIST_EVAL_TOKEN;"
        "const user = process.env.SMOKE_SPOTIFY_USER_ID || 'koalablade';"
        "fetch('$escapedUrl/api/generate?audit=1', {"
        "  method: 'POST',"
        "  headers: { 'Content-Type': 'application/json', 'x-kwalify-evaluation-token': token },"
        "  body: JSON.stringify({ vibe: 'chill evening', mode: 'balanced', length: 25, auditMode: true, spotifyUserId: user }),"
        "}).then(async r => { const d = await r.json(); const n = (d.tracks||[]).length;"
        "  console.log(JSON.stringify({ status: r.status, tracks: n }, null, 2));"
        "  if (!r.ok || n < 5) process.exit(1);"
        "}).catch(e => { console.error(e.message); process.exit(1); });"
      )
      $tmp = Join-Path $env:TEMP "kwalify-smoke-$stamp.js"
      Set-Content -LiteralPath $tmp -Value ($nodeLines -join "`n") -Encoding UTF8
      return Invoke-NpmNode -NodeArgs @($tmp) -Label "smoke"
    }
    { $_ -in @("easy", "medium", "hard", "edge", "human", "human-quick") } {
      $envExtra = @{ HUMAN_KEEP_BASE_URL = $Url; HUMAN_KEEP_SPAWN = if ($SpawnLocal) { "1" } else { "0" } }
      if ($Id -eq "human-quick") { $envExtra.HUMAN_KEEP_LIMIT = if ($Limit -gt 0) { "$Limit" } else { "15" } }
      elseif ($Id -ne "human") { $envExtra.HUMAN_KEEP_DIFFICULTY = $Id }
      if ($Limit -gt 0 -and $Id -eq "human") { $envExtra.HUMAN_KEEP_LIMIT = "$Limit" }
      if ($script:HumanKeepIds) { $envExtra.HUMAN_KEEP_IDS = $script:HumanKeepIds }
      if ($script:HumanKeepCohort) { $envExtra.HUMAN_KEEP_COHORT = $script:HumanKeepCohort }
      if ($script:HumanKeepDifficulty) { $envExtra.HUMAN_KEEP_DIFFICULTY = $script:HumanKeepDifficulty }
      if ($Variety) { $envExtra.HUMAN_KEEP_VARIETY = "1" }
      $label = if ($script:RunLabel) { $script:RunLabel } else { $Id }
      $code = Invoke-NpmScript -ScriptName "benchmark:human-keep-live" -EnvExtra $envExtra -Label $label
      $hk = Find-LatestHumanKeepRun
      if ($hk) { $script:lastReportPaths += @($hk.dir, $hk.summaryJson, $hk.summaryMd) }
      return $code
    }
    "reliability" {
      $args = @("--base-url", $Url, "--spotify-user-id", $User, "--token", $Token, "--out", $outReliability, "--delay-ms", "2000", "--timeout-ms", "180000")
      if ($Commit) { $args += @("--expected-deployment-version", $Commit) }
      if ($Limit -gt 0) { $args += @("--limit", "$Limit") }
      if ($Group) { $args += @("--group", $Group) }
      if ($DryRun) { $args += "--dry-run" }
      $code = Invoke-NpmNode -NodeArgs (@("backend/dist/scripts/prompt-reliability-benchmark.js") + $args) -Label "reliability"
      $script:lastReportPaths += @((Join-Path $root "$outReliability/prompt-reliability-report.json"))
      return $code
    }
    "reliability-human" {
      $script:Group = "Human"
      return Run-Suite -Id "reliability" -Url $Url -Commit $Commit -User $User -Token $Token
    }
    "opening" {
      $args = @("backend/dist/scripts/opening-curator-v2-benchmark.js", "--live", "--local")
      if ($SpawnLocal) { $args += "--spawn-local" }
      if ($DryRun) { $args += "--dry-run" }
      return Invoke-NpmNode -NodeArgs $args -Label "opening"
    }
    { $_ -in @("eval-10", "eval-50", "eval-100") } {
      $size = [int]($Id.Split("-")[1])
      $args = @("--base-url", $Url, "--spotify-user-id", $User, "--token", $Token, "--out", $outEval, "--benchmark-size", "$size", "--stratified", "--delay-ms", "1500", "--timeout-ms", "180000", "--checkpoint-every", "5")
      if ($Commit) { $args += @("--expected-deployment-version", $Commit) }
      if ($Resume) { $args += "--resume" } else { $args += "--fresh" }
      if ($DryRun) { $args += "--dry-run" }
      return Invoke-NpmNode -NodeArgs (@("backend/dist/scripts/playlist-evaluation-harness.js") + $args) -Label $Id
    }
    "6h" {
      $args = @("backend/dist/scripts/live-6h-benchmark.js", "--local")
      if ($SpawnLocal) { $args += "--spawn-local" }
      if ($Resume) { $args += "--resume" } else { $args += "--fresh" }
      return Invoke-NpmNode -NodeArgs $args -Label "live-6h"
    }
    "pairwise" {
      $env:KWALIFY_BENCHMARK_BASE_URL = $Url
      return Invoke-NpmScript -ScriptName "benchmark:pairwise-human-live" -Label "pairwise"
    }
    "human-saveability-overnight" {
      return Invoke-NpmScript -ScriptName "benchmark:human-saveability-overnight" -Label "overnight"
    }
    default { Exit-Benchmark 1 "Unknown suite '$Id'. Try: large, smoke, status" }
  }
}

# --- main ---
if ($Help) { Show-Help; exit 0 }

Rotate-Log
try {
  Start-Transcript -Path $logPath -Append | Out-Null
  $transcriptStarted = $true
  Write-Host "---- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') kwalify-benchmark ----"
} catch { Write-WarnLine "Could not write log file" }

Acquire-Lock

$sc = Join-Path $PSScriptRoot "create-kwalify-shortcuts.ps1"
if (Test-Path $sc) { & powershell -NoProfile -ExecutionPolicy Bypass -File $sc -Root $root 2>$null | Out-Null }

if (-not (Test-Path (Join-Path $root "package.json"))) { Exit-Benchmark 1 "Run from Kwalify project root." }

. "$PSScriptRoot\load-dotenv.ps1" -Root $root
if (-not $env:SMOKE_SPOTIFY_USER_ID) { $env:SMOKE_SPOTIFY_USER_ID = "koalablade" }

if (-not $Production -and -not $PSBoundParameters.ContainsKey('SpawnLocal')) { $SpawnLocal = $true }

if ($PromptIds) { $script:HumanKeepIds = $PromptIds }
if ($Cohort) { $script:HumanKeepCohort = $Cohort }
if ($DifficultyFilter) { $script:HumanKeepDifficulty = $DifficultyFilter }

if ($Request) {
  $parsed = Parse-NaturalBenchmarkRequest -Request $Request
  if ($parsed) {
    Apply-MenuConfig $parsed
    $Suite = $parsed.suite
    if ($parsed.limit) { $Limit = [int]$parsed.limit }
    if ($parsed.variety) { $Variety = $true }
    if ($parsed.package) { $Package = $true }
    if ($parsed.noMenu) { $NoMenu = $true }
    if ($parsed.spawnLocal) { $SpawnLocal = $true }
  } else {
    Exit-Benchmark 1 "Could not understand request: $Request"
  }
}

if ($RepeatLast) {
  $parsed = Restore-LastBenchmarkChoice
  if (-not $parsed) { Exit-Benchmark 1 "No previous benchmark to repeat." }
  Apply-MenuConfig $parsed
  $Suite = $parsed.suite
  if ($parsed.limit) { $Limit = [int]$parsed.limit }
  if ($parsed.variety) { $Variety = $true }
  if ($parsed.package) { $Package = $true }
  $NoMenu = $true
}

if (-not $Suite -and -not $NoMenu) {
  if (Test-ShouldShowWeeklyGuide) {
    Write-Host "  Opening benchmark guide (weekly reminder)..." -ForegroundColor DarkGray
    Open-BenchmarkGuide | Out-Null
    Mark-GuideShown
  }
  while ($true) {
    $menuPick = Show-BenchmarkMainMenu
    if (-not $menuPick) { continue }
    if ($menuPick.suite -eq "_more") {
      $adv = Show-AdvancedMenu
      if ($adv) { $Suite = $adv; break }
      continue
    }
    if ($menuPick.suite -eq "help") {
      if (-not (Open-BenchmarkGuide)) { Show-Help }
      continue
    }
    if ($menuPick.suite -eq "guide") {
      Open-BenchmarkGuide | Out-Null
      continue
    }
    if ($menuPick.suite -eq "history") {
      Open-BenchmarkHistory | Out-Null
      continue
    }
    Apply-MenuConfig $menuPick
    $Suite = $menuPick.suite
    if ($script:LimitFromMenu) { $Limit = $script:LimitFromMenu }
    if ($script:VarietyFromMenu) { $Variety = $true }
    if ($script:PackageFromMenu) { $Package = $true }
    if ($script:SpawnLocalFromMenu) { $SpawnLocal = $true }
    if ($script:NoMenuFromMenu) { $NoMenu = $true }
    break
  }
}
if (-not $Suite -or $Suite -eq "help") { Show-Help; Exit-Benchmark 0 "" }
if ($Suite -eq "go" -or $Suite -eq "recommended") {
  $cfg = Get-RecommendedHumanConfig -Size 50
  Apply-MenuConfig $cfg
  $Suite = "human"
  $Limit = 50
  $Variety = $true
  $Package = $true
  if (-not $PSBoundParameters.ContainsKey('NoMenu')) { $NoMenu = $true }
}
if ($Suite -eq "guide") {
  if (Open-BenchmarkGuide) { Exit-Benchmark 0 "" }
  Show-Help
  Exit-Benchmark 0 ""
}
if ($Suite -eq "history") {
  if (Open-BenchmarkHistory) { Exit-Benchmark 0 "" }
  Exit-Benchmark 1 "benchmark-history.html not found"
}

$Suite = $Suite.Trim().ToLower()

$tierAliases = @{
  "tier-easy" = "easy"; "tier-medium" = "medium"; "tier-hard" = "hard"; "tier-edge" = "edge"
}
if ($tierAliases.ContainsKey($Suite)) { $Suite = $tierAliases[$Suite] }

$sizePicker = @{ small = 25; medium = 50; long = 100; large = 100; full = 100 }
$mixPresets = @("mix-small", "mix-medium", "mix-long", "mix-large", "mix-full")

if ($sizePicker.ContainsKey($Suite) -and -not $NoMenu) {
  if (-not (Invoke-PromptPickerForSize -Size $sizePicker[$Suite])) {
    Exit-Benchmark 0 "Cancelled."
  }
  $Suite = $script:SuiteFromPicker
  if ($script:Limit) { $Limit = $script:Limit }
  if ($Suite -eq "human" -and -not $PSBoundParameters.ContainsKey('Package')) { $Package = $true }
} elseif ($Suite -in $mixPresets) {
  $preset = Apply-SuitePresets $Suite
  Apply-MenuConfig $preset
  if ($preset.suite) { $Suite = $preset.suite }
  if ($preset.limit -and $Limit -le 0) { $Limit = [int]$preset.limit }
  if ($preset.ids) { $script:HumanKeepIds = $preset.ids }
  if ($preset.variety) { $Variety = $true }
  if ($preset.spawnLocal) { $SpawnLocal = $true }
  if ($preset.package) { $Package = $true }
  if ($preset.label) { $script:RunLabel = $preset.label }
  if ($Suite -eq "human") { $Package = $true }
} else {
  $preset = Apply-SuitePresets $Suite
  Apply-MenuConfig $preset
  if ($preset.suite) { $Suite = $preset.suite }
  if ($script:LimitFromMenu -and $Limit -le 0) { $Limit = $script:LimitFromMenu }
  if ($preset.limit -and $Limit -le 0) { $Limit = [int]$preset.limit }
  if ($preset.ids -and -not $script:HumanKeepIds) { $script:HumanKeepIds = $preset.ids }
  if ($preset.variety) { $Variety = $true }
  if ($preset.spawnLocal) { $SpawnLocal = $true }
  if ($preset.package) { $Package = $true }
  if ($preset.noMenu) { $NoMenu = $true }
  if ($preset.label) { $script:RunLabel = $preset.label }
  if ($Suite -eq "human" -and -not $PSBoundParameters.ContainsKey('Package')) { $Package = $true }
}

$aliases = @{ "human-100"="human"; "human100"="human"; "live-6h"="6h"; "eval10"="eval-10"; "eval50"="eval-50"; "eval100"="eval-100" }
if ($aliases.ContainsKey($Suite)) { $Suite = $aliases[$Suite] }

if ($Suite -in @("status", "package")) {
  Exit-Benchmark (Run-Suite -Id $Suite -Url "" -Commit $null -User "" -Token "") ""
}

$url = Get-ResolvedBaseUrl
$token = $env:PLAYLIST_EVAL_TOKEN
$user = $env:SMOKE_SPOTIFY_USER_ID

if (-not $token -and -not $DryRun) {
  Write-ErrLine "PLAYLIST_EVAL_TOKEN missing in .env"
  Exit-Benchmark 1 "Missing PLAYLIST_EVAL_TOKEN"
}

if ($Suite -eq "human") {
  $resolveCfg = @{
    limit = $Limit
    cohort = $script:HumanKeepCohort
    difficulty = $script:HumanKeepDifficulty
    variety = [bool]$Variety
  }
  foreach ($k in @("presetKey", "humanOnly", "fullMix", "freezeIds", "tierMix", "ids")) {
    if ($script:MenuChoice.ContainsKey($k)) { $resolveCfg[$k] = $script:MenuChoice[$k] }
  }
  if ($script:HumanKeepIds -and -not $resolveCfg.freezeIds) {
    $resolveCfg.ids = $script:HumanKeepIds
  }
  if ($PromptIds) { $resolveCfg.ids = $PromptIds; $resolveCfg.freezeIds = $true; $resolveCfg.presetKey = "hand-picked" }
  $resolved = Resolve-BenchmarkPromptSelection -Cfg $resolveCfg
  if ($resolved.ids) { $script:HumanKeepIds = $resolved.ids }
  if ($resolved.limit) { $Limit = [int]$resolved.limit }
  if ($resolved.label) { $script:RunLabel = $resolved.label }
  if ($resolved.variety) { $Variety = $true }
  if ($resolved.rotationNote) { $script:RotationNote = $resolved.rotationNote }
  if ($resolved.presetKey) { $script:MenuChoice.presetKey = $resolved.presetKey }
}

if (-not $DryRun) {
  if (-not (Invoke-BenchmarkPreflight -Url $url -Token $token -SpawnLocal:$SpawnLocal)) {
    Exit-Benchmark 1 "Pre-flight failed. Fix the issues above and try again."
  }
}

$meta = @{
  suite = $Suite
  url = $url
  label = if ($script:RunLabel) { $script:RunLabel } else { $Suite }
  limit = if ($Limit -gt 0) { $Limit } else { "default" }
}
if ($script:HumanKeepIds) { $meta.prompts = $script:HumanKeepIds }
if ($script:HumanKeepCohort) { $meta.cohort = $script:HumanKeepCohort }
if ($script:HumanKeepDifficulty) { $meta.difficulty = $script:HumanKeepDifficulty }
if ($Variety) { $meta.variety = "on" }

Step $(if ($script:RunLabel) { $script:RunLabel } else { "Benchmark: $Suite" })
Write-Host "  Target: $url  User: $user"

$promptCount = if ($Limit -gt 0) { $Limit } elseif ($script:HumanKeepIds) { @($script:HumanKeepIds -split ',').Count } else { 25 }
if ($Suite -eq "human") {
  Show-RunPreview -Meta $meta -PromptCount $promptCount -RotationNote $script:RotationNote
}
if (-not $NoMenu -and -not $DryRun) {
  $ans = Read-Host "  Start now? [Y/n]"
  if ($ans -and $ans.Trim().ToLower() -in @("n", "no")) { Exit-Benchmark 0 "Cancelled." }
}

if ($DryRun) {
  Write-Ok "Dry run only - would execute suite '$Suite' against $url"
  Exit-Benchmark 0 ""
}

Ensure-Build
if ($Suite -ne "smoke") { Ensure-BenchmarkEnv }

$commit = Get-DeployedCommit $url
$script:BenchmarkRunState = Initialize-BenchmarkRun -RunId $script:BenchmarkRunId -Suite $Suite -BaseUrl $url -User $user -Commit $commit -Options @{ limit = $Limit; package = [bool]$Package; label = $script:RunLabel }
if ($script:RunLabel) { $script:BenchmarkRunState.label = $script:RunLabel }

if ($Suite -eq "human" -and -not $DryRun) {
  Open-BenchmarkStatusPage | Out-Null
}

$exitCode = Run-Suite -Id $Suite -Url $url -Commit $commit -User $user -Token $token
$metrics = Collect-MetricsFromReports -ReportPaths $lastReportPaths
Complete-BenchmarkRun -RunId $script:BenchmarkRunId -State $script:BenchmarkRunState -ExitCode $exitCode -Metrics $metrics -ReportPaths $lastReportPaths

$choiceToSave = @{}
if ($script:MenuChoice.Count -gt 0 -or $Suite -eq "human") {
  $choiceToSave = @{
    suite = $Suite
    limit = $Limit
    label = $script:RunLabel
    cohort = $script:HumanKeepCohort
    difficulty = $script:HumanKeepDifficulty
    variety = [bool]$Variety
    package = [bool]$Package
    humanOnly = [bool]$script:MenuChoice.humanOnly
    fullMix = [bool]$script:MenuChoice.fullMix
    freezeIds = [bool]$script:MenuChoice.freezeIds
    presetKey = [string]$script:MenuChoice.presetKey
  }
  if ($script:MenuChoice.tierMix) { $choiceToSave.tierMix = $script:MenuChoice.tierMix }
  if ($script:MenuChoice.freezeIds -and $script:HumanKeepIds) {
    $choiceToSave.ids = $script:HumanKeepIds
  }
}
if ($Suite -eq "human") {
  Finalize-BenchmarkUx -RunId $script:BenchmarkRunId -State $script:BenchmarkRunState -ExitCode $exitCode -Metrics $metrics -Choice $choiceToSave
  if ($exitCode -eq 0 -and $script:MenuChoice.presetKey -and $script:HumanKeepIds) {
    Record-BenchmarkPromptRotation -PresetKey $script:MenuChoice.presetKey -Ids @($script:HumanKeepIds -split ",") -RunId $script:BenchmarkRunId
  }
}

if ($Package -and $exitCode -eq 0) {
  try { Write-Ok "Packaged: $(Package-BenchmarkRun -RunId $script:BenchmarkRunId)" } catch { Write-WarnLine $_.Exception.Message }
}

Write-Host ""
if ($exitCode -eq 0) {
  Write-Host "  BENCHMARK COMPLETE" -ForegroundColor Green
  Write-Host ("  Wall time: {0:N1} min" -f ((Get-Date) - $runStartedAt).TotalMinutes)
  if ($metrics.Count -gt 0) { Write-Host (Format-MetricsDashboard -Metrics $metrics) }
  Write-Host "  Plain summary + HTML report in reports\benchmark-runs\$($script:BenchmarkRunId)" -ForegroundColor DarkGray
  Open-ReportsFolder
} else {
  Write-Host "  FAILED (exit $exitCode) - see kwalify-benchmark.log and reports\BENCHMARK-STATUS.txt" -ForegroundColor Red
}

Exit-Benchmark $exitCode $(if ($exitCode -ne 0) { "Suite '$Suite' failed." } else { "" })
