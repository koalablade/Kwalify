# Shared benchmark helpers: run state, metrics, packaging, status display.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$script:BenchmarkRoot = $Root
$script:BenchmarkRunsDir = Join-Path $Root "reports\benchmark-runs"
$script:BenchmarkStatusFile = Join-Path $Root "reports\BENCHMARK-STATUS.txt"
$script:BenchmarkLatestJson = Join-Path $Root "reports\benchmark-latest.json"

function New-BenchmarkRunId {
  return (Get-Date -Format "yyyyMMdd-HHmmss")
}

function Ensure-BenchmarkRunsDir {
  if (-not (Test-Path -LiteralPath $script:BenchmarkRunsDir)) {
    New-Item -ItemType Directory -Force -Path $script:BenchmarkRunsDir | Out-Null
  }
}

function Get-BenchmarkRunDir([string]$RunId) {
  Ensure-BenchmarkRunsDir
  return Join-Path $script:BenchmarkRunsDir $RunId
}

function Initialize-BenchmarkRun {
  param(
    [string]$RunId,
    [string]$Suite,
    [string]$BaseUrl,
    [string]$User,
    [string]$Commit,
    [hashtable]$Options = @{}
  )
  $dir = Get-BenchmarkRunDir $RunId
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $state = @{
    runId = $RunId
    suite = $Suite
    status = "starting"
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    baseUrl = $BaseUrl
    spotifyUser = $User
    gitCommit = $Commit
    options = $Options
    progress = @{
      completed = 0
      total = 0
      currentPrompt = $null
      currentId = $null
      percent = 0
    }
    metrics = @{}
    reportPaths = @()
    logPath = (Join-Path $script:BenchmarkRoot "kwalify-benchmark.log")
  }
  Save-BenchmarkRunState -RunId $RunId -State $state
  return $state
}

function Save-BenchmarkRunState {
  param(
    [string]$RunId,
    [hashtable]$State
  )
  $dir = Get-BenchmarkRunDir $RunId
  $State.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  $jsonPath = Join-Path $dir "run-state.json"
  $State | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
  $latest = @{
    runId = $RunId
    runDir = $dir
    suite = $State.suite
    status = $State.status
    updatedAt = $State.updatedAt
    progress = $State.progress
    metrics = $State.metrics
  }
  $latest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:BenchmarkLatestJson -Encoding UTF8
  Write-BenchmarkStatusText -RunId $RunId -State $State
}

function Write-BenchmarkStatusText {
  param(
    [string]$RunId,
    [hashtable]$State
  )
  $lines = @(
    "KWALIFY BENCHMARK STATUS",
    "========================",
    "Updated: $($State.updatedAt)",
    "Run ID:  $RunId",
    "Suite:   $($State.suite)",
    "Status:  $($State.status)",
    "Target:  $($State.baseUrl)",
    "User:    $($State.spotifyUser)",
    "Commit:  $($State.gitCommit)",
    ""
  )
  $p = $State.progress
  if ($p -and $p.total -gt 0) {
    $lines += "PROGRESS: $($p.completed)/$($p.total) ($($p.percent)%)"
    if ($p.currentId) { $lines += "Current:  $($p.currentId) - $($p.currentPrompt)" }
    $lines += ""
  }
  if ($State.metrics -and $State.metrics.Count -gt 0) {
    $lines += "METRICS"
    $lines += "-------"
    foreach ($k in ($State.metrics.Keys | Sort-Object)) {
      $lines += ("  {0}: {1}" -f $k, $State.metrics[$k])
    }
    $lines += ""
  }
  if ($State.reportPaths -and $State.reportPaths.Count -gt 0) {
    $lines += "REPORTS"
    $lines += "-------"
    foreach ($rp in $State.reportPaths) { $lines += "  $rp" }
    $lines += ""
  }
  $lines += "Full log: $(Join-Path $script:BenchmarkRoot 'kwalify-benchmark.log')"
  $lines += "Run folder: $(Get-BenchmarkRunDir $RunId)"
  $text = $lines -join "`r`n"
  $dir = Get-BenchmarkRunDir $RunId
  Set-Content -LiteralPath (Join-Path $dir "STATUS.txt") -Value $text -Encoding UTF8
  Set-Content -LiteralPath $script:BenchmarkStatusFile -Value $text -Encoding UTF8
}

function Update-BenchmarkProgress {
  param(
    [string]$RunId,
    [hashtable]$State,
    [int]$Completed,
    [int]$Total,
    [string]$CurrentId = "",
    [string]$CurrentPrompt = ""
  )
  $State.progress.completed = $Completed
  $State.progress.total = $Total
  $State.progress.currentId = $CurrentId
  $State.progress.currentPrompt = $CurrentPrompt
  $State.progress.percent = if ($Total -gt 0) { [math]::Round(100 * $Completed / $Total, 1) } else { 0 }
  $State.status = "running"
  Save-BenchmarkRunState -RunId $RunId -State $State
}

function Complete-BenchmarkRun {
  param(
    [string]$RunId,
    [hashtable]$State,
    [int]$ExitCode,
    [hashtable]$Metrics = @{},
    [string[]]$ReportPaths = @()
  )
  $State.status = if ($ExitCode -eq 0) { "completed" } elseif ($ExitCode -eq 2) { "completed_with_warnings" } else { "failed" }
  $State.exitCode = $ExitCode
  $State.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
  foreach ($k in $Metrics.Keys) { $State.metrics[$k] = $Metrics[$k] }
  $State.reportPaths = @($ReportPaths | Where-Object { $_ })
  Save-BenchmarkRunState -RunId $RunId -State $State
  Write-BenchmarkShareableSummary -RunId $RunId -State $State
}

function Get-LatestBenchmarkRun {
  if (-not (Test-Path -LiteralPath $script:BenchmarkLatestJson)) { return $null }
  try {
    return Get-Content -LiteralPath $script:BenchmarkLatestJson -Raw | ConvertFrom-Json
  } catch { return $null }
}

function Find-LatestHumanKeepRun {
  $base = Join-Path $script:BenchmarkRoot "reports\playlist-evaluation\human-keep-live"
  if (-not (Test-Path $base)) { return $null }
  $dir = Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $dir) { return $null }
  return @{
    dir = $dir.FullName
    summaryJson = Join-Path $dir.FullName "summary.json"
    summaryMd = Join-Path $dir.FullName "SUMMARY.md"
  }
}

function Parse-HumanKeepMetrics([string]$SummaryJsonPath) {
  if (-not (Test-Path -LiteralPath $SummaryJsonPath)) { return @{} }
  try {
    $s = Get-Content -LiteralPath $SummaryJsonPath -Raw | ConvertFrom-Json
    $m = @{
      promptCount = $s.promptCount
      wouldSaveRate = $s.wouldSaveRate
      keepableRate = $s.keepableRate
      wouldSkipRate = $s.wouldSkipRate
      avgMs = $s.avgMs
      SAVE = $s.counts.SAVE
      PARTIAL_OK = $s.counts.PARTIAL_OK
      MAYBE = $s.counts.MAYBE
      SKIP = $s.counts.SKIP
      REFUSE_OK = $s.counts.REFUSE_OK
      EMPTY_BAD = $s.counts.EMPTY_BAD
    }
    if ($s.underfilledCount -ne $null) { $m.underfilledCount = $s.underfilledCount }
    if ($s.avgFillRatio -ne $null) { $m.avgFillRatio = $s.avgFillRatio }
    if ($s.avgUnderfillRatio -ne $null) { $m.avgUnderfillRatio = $s.avgUnderfillRatio }
    return $m
  } catch { return @{} }
}

function Parse-ReliabilityMetrics([string]$ReportJsonPath) {
  if (-not (Test-Path -LiteralPath $ReportJsonPath)) { return @{} }
  try {
    $r = Get-Content -LiteralPath $ReportJsonPath -Raw | ConvertFrom-Json
    $m = @{
      promptReliabilityScore = $r.summary.promptReliabilityScore
      successRate = $r.summary.successRate
      successCount = $r.summary.successCount
      promptCount = $r.run.promptCount
      blockingFailureCount = $r.summary.blockingFailureCount
      underfilledCount = $r.summary.underfilledCount
      averageConfidenceScore = $r.summary.averageConfidenceScore
      averageSurvivalPercent = $r.summary.averageSurvivalPercent
    }
    if ($r.delivery) {
      $m.deliveryIdeal = $r.delivery.idealCount
      $m.deliveryDegraded = $r.delivery.degradedCount
      $m.deliverySafe = $r.delivery.safeCount
      $m.deliveryEmergency = $r.delivery.emergencyCount
    }
    return $m
  } catch { return @{} }
}

function Collect-MetricsFromReports {
  param([string[]]$ReportPaths)
  $metrics = @{}
  foreach ($p in $ReportPaths) {
    if (-not $p) { continue }
    if ($p -match "summary\.json$" -and $p -match "human-keep") {
      $hk = Parse-HumanKeepMetrics $p
      foreach ($k in $hk.Keys) { $metrics["human_$k"] = $hk[$k] }
    }
    if ($p -match "prompt-reliability-report\.json$") {
      $rl = Parse-ReliabilityMetrics $p
      foreach ($k in $rl.Keys) { $metrics["reliability_$k"] = $rl[$k] }
    }
    if ((Test-Path $p) -and (Get-Item $p).PSIsContainer) {
      $sj = Join-Path $p "summary.json"
      if (Test-Path $sj) {
        $hk = Parse-HumanKeepMetrics $sj
        foreach ($k in $hk.Keys) { $metrics["human_$k"] = $hk[$k] }
      }
      $pr = Get-ChildItem -Path $p -Filter "prompt-reliability-report.json" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($pr) {
        $rl = Parse-ReliabilityMetrics $pr.FullName
        foreach ($k in $rl.Keys) { $metrics["reliability_$k"] = $rl[$k] }
      }
    }
  }
  $latest = Find-LatestHumanKeepRun
  if ($latest -and (Test-Path $latest.summaryJson)) {
    $hk = Parse-HumanKeepMetrics $latest.summaryJson
    foreach ($k in $hk.Keys) { if (-not $metrics.ContainsKey("human_$k")) { $metrics["human_$k"] = $hk[$k] } }
  }
  return $metrics
}

function Format-MetricsDashboard {
  param([hashtable]$Metrics)
  if ($Metrics.Count -eq 0) { return "  (no metrics yet)" }
  $lines = @()
  $humanKeys = @(
    @{ Key = "human_SAVE"; Label = "SAVE (would save)" }
    @{ Key = "human_PARTIAL_OK"; Label = "PARTIAL_OK (honest partial)" }
    @{ Key = "human_MAYBE"; Label = "MAYBE (skip-heavy)" }
    @{ Key = "human_SKIP"; Label = "SKIP (abandon)" }
    @{ Key = "human_REFUSE_OK"; Label = "REFUSE_OK (honest empty)" }
    @{ Key = "human_EMPTY_BAD"; Label = "EMPTY_BAD (bad empty)" }
    @{ Key = "human_wouldSaveRate"; Label = "Would-save rate" }
    @{ Key = "human_keepableRate"; Label = "Keepable rate" }
    @{ Key = "human_wouldSkipRate"; Label = "Skip rate" }
    @{ Key = "human_underfilledCount"; Label = "Underfilled prompts" }
    @{ Key = "human_avgFillRatio"; Label = "Avg fill ratio" }
    @{ Key = "human_avgMs"; Label = "Avg gen time (ms)" }
  )
  $relKeys = @(
    @{ Key = "reliability_promptReliabilityScore"; Label = "Reliability score" }
    @{ Key = "reliability_successRate"; Label = "Success rate %" }
    @{ Key = "reliability_underfilledCount"; Label = "Underfilled" }
    @{ Key = "reliability_blockingFailureCount"; Label = "Blocking failures" }
    @{ Key = "reliability_deliveryIdeal"; Label = "Delivery ideal" }
    @{ Key = "reliability_deliveryDegraded"; Label = "Delivery degraded" }
  )
  $hasHuman = $humanKeys | Where-Object { $Metrics.ContainsKey($_.Key) }
  $hasRel = $relKeys | Where-Object { $Metrics.ContainsKey($_.Key) }
  if ($hasHuman) {
    $lines += "  HUMAN SAVE / KEEP"
    foreach ($h in $hasHuman) {
      $lines += ("    {0,-28} {1}" -f ($h.Label + ":"), $Metrics[$h.Key])
    }
  }
  if ($hasRel) {
    $lines += "  GOLDEN RELIABILITY"
    foreach ($r in $hasRel) {
      $lines += ("    {0,-28} {1}" -f ($r.Label + ":"), $Metrics[$r.Key])
    }
  }
  return ($lines -join "`n")
}

function Write-BenchmarkShareableSummary {
  param(
    [string]$RunId,
    [hashtable]$State
  )
  $dir = Get-BenchmarkRunDir $RunId
  $sharePath = Join-Path $dir "SHAREABLE-SUMMARY.md"
  $lines = @(
    "# Kwalify Benchmark Run",
    "",
    "| Field | Value |",
    "|-------|-------|",
    "| Run ID | ``$RunId`` |",
    "| Suite | $($State.suite) |",
    "| Status | $($State.status) |",
    "| Started | $($State.startedAt) |",
    "| Finished | $($State.finishedAt) |",
    "| Target | $($State.baseUrl) |",
    "| Git commit | $($State.gitCommit) |",
  ""
  )
  if ($State.metrics.Count -gt 0) {
    $lines += "## Metrics"
    $lines += ""
    $lines += "| Metric | Value |"
    $lines += "|--------|-------|"
    foreach ($k in ($State.metrics.Keys | Sort-Object)) {
      $lines += "| $k | $($State.metrics[$k]) |"
    }
    $lines += ""
  }
  if ($State.reportPaths.Count -gt 0) {
    $lines += "## Report paths"
    $lines += ""
    foreach ($rp in $State.reportPaths) { $lines += "- ``$rp``" }
    $lines += ""
  }
  $lines += "## Files to attach when sharing"
  $lines += ""
  $lines += "- ``STATUS.txt`` (this run)"
  $lines += "- ``run-state.json``"
  $lines += "- ``SHAREABLE-SUMMARY.md``"
  $lines += "- ``kwalify-benchmark.log`` (project root)"
  $lines += "- Suite output under ``reports/``"
  Set-Content -LiteralPath $sharePath -Value ($lines -join "`n") -Encoding UTF8
}

function Package-BenchmarkRun {
  param(
    [string]$RunId = "",
    [string]$OutZip = ""
  )
  Ensure-BenchmarkRunsDir
  if (-not $RunId) {
    $latest = Get-LatestBenchmarkRun
    if ($latest) { $RunId = $latest.runId }
  }
  if (-not $RunId) { throw "No benchmark run found to package." }
  $runDir = Get-BenchmarkRunDir $RunId
  if (-not (Test-Path $runDir)) { throw "Run folder not found: $runDir" }
  if (-not $OutZip) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $OutZip = Join-Path $desktop "kwalify-benchmark-$RunId.zip"
  }
  $staging = Join-Path $env:TEMP "kwalify-bench-pkg-$RunId"
  if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  Copy-Item -LiteralPath $runDir -Destination (Join-Path $staging "run-$RunId") -Recurse
  $log = Join-Path $script:BenchmarkRoot "kwalify-benchmark.log"
  if (Test-Path $log) { Copy-Item -LiteralPath $log -Destination $staging }
  $status = Join-Path $script:BenchmarkRoot "reports\BENCHMARK-STATUS.txt"
  if (Test-Path $status) { Copy-Item -LiteralPath $status -Destination $staging }
  foreach ($htmlName in @("benchmark-report-latest.html", "benchmark-live.json", "benchmark-history.json")) {
    $htmlSrc = Join-Path $script:BenchmarkRoot "reports\$htmlName"
    if (Test-Path -LiteralPath $htmlSrc) { Copy-Item -LiteralPath $htmlSrc -Destination $staging }
  }
  $runHtml = Join-Path $runDir "benchmark-report.html"
  if (Test-Path -LiteralPath $runHtml) { Copy-Item -LiteralPath $runHtml -Destination $staging }
  $plain = Join-Path $runDir "PLAIN-ENGLISH-SUMMARY.txt"
  if (Test-Path -LiteralPath $plain) { Copy-Item -LiteralPath $plain -Destination $staging }
  $state = Get-Content (Join-Path $runDir "run-state.json") -Raw | ConvertFrom-Json
  foreach ($rp in @($state.reportPaths)) {
    if (-not $rp) { continue }
    if (Test-Path -LiteralPath $rp) {
      $rel = "reports-" + ($rp -replace '[\\:]+', '-')
      if ((Get-Item $rp).PSIsContainer) {
        Copy-Item -LiteralPath $rp -Destination (Join-Path $staging $rel) -Recurse -ErrorAction SilentlyContinue
      } else {
        $destDir = Join-Path $staging (Split-Path $rel -Parent)
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
        Copy-Item -LiteralPath $rp -Destination (Join-Path $staging $rel) -ErrorAction SilentlyContinue
      }
    }
  }
  if (Test-Path -LiteralPath $OutZip) { Remove-Item -LiteralPath $OutZip -Force }
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $OutZip -Force
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  return $OutZip
}

function Show-BenchmarkStatus {
  $statusFile = $script:BenchmarkStatusFile
  if (Test-Path -LiteralPath $statusFile) {
    Get-Content -LiteralPath $statusFile | ForEach-Object { Write-Host $_ }
    Write-Host ""
    $latest = Get-LatestBenchmarkRun
    if ($latest -and $latest.metrics) {
      Write-Host "METRICS DASHBOARD" -ForegroundColor Cyan
      $m = @{}
      $latest.metrics.PSObject.Properties | ForEach-Object { $m[$_.Name] = $_.Value }
      Write-Host (Format-MetricsDashboard -Metrics $m)
    }
    return
  }
  Write-Host "No benchmark run in progress. Double-click Start Kwalify Benchmark."
}

function Test-ApiRunning([string]$Url = "http://127.0.0.1:5000") {
  try {
    $rz = Invoke-RestMethod -Uri "$Url/api/healthz" -TimeoutSec 4
    return $true
  } catch { return $false }
}

function Ensure-KwalifyRunning {
  param([string]$Url = "http://127.0.0.1:5000")
  if (Test-ApiRunning $Url) { return $true }
  $startBat = Join-Path $script:BenchmarkRoot "start-kwalify.bat"
  if (-not (Test-Path -LiteralPath $startBat)) { return $false }
  Write-Host ""
  Write-Host "  Starting Kwalify automatically (wait ~60s)..." -ForegroundColor Yellow
  Start-Process -FilePath $startBat -ArgumentList "quick" -WorkingDirectory $script:BenchmarkRoot -WindowStyle Minimized | Out-Null
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    if (Test-ApiRunning $Url) {
      Write-Host "  Kwalify is up." -ForegroundColor Green
      return $true
    }
    Start-Sleep -Seconds 3
  }
  Write-Host "  Kwalify did not start in time. Run 'Start Kwalify' on Desktop first." -ForegroundColor Red
  return $false
}

function Ensure-ApiHint {
  param([string]$Url, [switch]$SpawnLocal)
  if (Test-ApiRunning $Url) { return $true }
  if ($SpawnLocal) {
    return Ensure-KwalifyRunning $Url
  }
  Write-Host ""
  Write-Host "  API not running. Double-click 'Start Kwalify' on Desktop first." -ForegroundColor Yellow
  return $false
}
