# Benchmark UX: preflight, notifications, history, summaries, live dashboard sync.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$script:UxRoot = $Root
$script:LastChoicePath = Join-Path $Root "reports\benchmark-last-choice.json"
$script:HistoryPath = Join-Path $Root "reports\benchmark-history.json"
$script:GuideFlagPath = Join-Path $Root "reports\.benchmark-guide-shown"
$script:LiveJsonPath = Join-Path $Root "reports\benchmark-live.json"
$script:StuckWatchJob = $null

function Get-BenchmarkMinutesPerPrompt([int]$Count) {
  if ($Count -le 25) { return 2.4 }
  if ($Count -le 50) { return 2.5 }
  return 2.6
}

function Get-BenchmarkEtaText([int]$PromptCount) {
  $mins = [math]::Round($PromptCount * (Get-BenchmarkMinutesPerPrompt $PromptCount), 0)
  $done = (Get-Date).AddMinutes($mins)
  return @{ minutes = $mins; doneAt = $done.ToString("h:mm tt") }
}

function Invoke-BenchmarkPreflight {
  param([string]$Url, [string]$Token, [switch]$SpawnLocal)
  Write-Host ""
  Write-Host "  PRE-FLIGHT CHECKS" -ForegroundColor Cyan
  $ok = $true
  $fixes = @()

  if (-not $Token) {
    Write-ErrLine "FAIL  PLAYLIST_EVAL_TOKEN missing in .env"
    $fixes += "Run: npm run sync:eval-token -Token `"<21-char token>`""
    $ok = $false
  } elseif ($Token.Length -ne 21) {
    Write-ErrLine "FAIL  Token length is $($Token.Length) (need 21)"
    $fixes += "Update .env and restart Kwalify"
    $ok = $false
  } else {
    Write-Ok "PASS  Eval token present"
  }

  if (-not (Test-ApiRunning $Url)) {
    if ($SpawnLocal) {
      Write-WarnLine "WAIT  API down - starting Kwalify..."
      if (-not (Ensure-KwalifyRunning $Url)) { $ok = $false; $fixes += "Double-click Start Kwalify on Desktop" }
      else { Write-Ok "PASS  API started" }
    } else {
      Write-ErrLine "FAIL  API not running at $Url"
      $fixes += "Double-click Start Kwalify on Desktop"
      $ok = $false
    }
  } else {
    Write-Ok "PASS  API reachable"
  }

  if ($Token -and (Test-ApiRunning $Url)) {
    try {
      $ping = Invoke-RestMethod -Method Post -Uri "$Url/api/eval/ping" -Headers @{ "x-kwalify-evaluation-token" = $Token } -TimeoutSec 15
      if ($ping.tokenAccepted -eq $true) { Write-Ok "PASS  Eval token accepted" }
      else { Write-ErrLine "FAIL  Eval token rejected"; $fixes += "Restart Kwalify after updating .env"; $ok = $false }
    } catch {
      Write-ErrLine "FAIL  Eval ping failed: $($_.Exception.Message)"
      $ok = $false
    }
  }

  $freeGb = (Get-PSDrive C).Free / 1GB
  if ($freeGb -lt 1) {
    Write-WarnLine "WARN  Low disk space ($([math]::Round($freeGb,1)) GB free)"
  } else {
    Write-Ok "PASS  Disk space OK"
  }

  if (-not $ok) {
    Write-Host ""
    Write-Host "  FIX:" -ForegroundColor Yellow
    foreach ($f in $fixes) { Write-Host "    - $f" }
    return $false
  }
  Write-Host ""
  Write-Ok "All pre-flight checks passed"
  return $true
}

function Save-BenchmarkLastChoice([hashtable]$Choice) {
  $dir = Split-Path $script:LastChoicePath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $Choice.savedAt = (Get-Date).ToUniversalTime().ToString("o")
  $Choice | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $script:LastChoicePath -Encoding UTF8
}

function Get-BenchmarkLastChoice {
  if (-not (Test-Path -LiteralPath $script:LastChoicePath)) { return $null }
  try { return Get-Content -LiteralPath $script:LastChoicePath -Raw | ConvertFrom-Json } catch { return $null }
}

function Add-BenchmarkHistoryEntry {
  param([hashtable]$Entry)
  $list = @()
  if (Test-Path -LiteralPath $script:HistoryPath) {
    try { $list = @(Get-Content -LiteralPath $script:HistoryPath -Raw | ConvertFrom-Json) } catch {}
  }
  $list = ,$Entry + @($list | Select-Object -First 19)
  $dir = Split-Path $script:HistoryPath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $list | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:HistoryPath -Encoding UTF8
}

function Get-WhatToDoNext([hashtable]$Metrics) {
  $lines = @()
  $saveRate = $Metrics["human_wouldSaveRate"]
  $skipRate = $Metrics["human_wouldSkipRate"]
  $underfill = $Metrics["human_underfilledCount"]
  if ($saveRate -ne $null -and [double]$saveRate -lt 0.35) {
    $lines += "SAVE rate is low - try easy tier or check world-identity gate logs."
  }
  if ($underfill -gt 3) {
    $lines += "Several underfilled playlists - retrieval may be thin for those prompts."
  }
  if ($skipRate -ne $null -and [double]$skipRate -gt 0.4) {
    $lines += "High SKIP rate - review by-verdict/SKIP folder for world-break patterns."
  }
  if ($lines.Count -eq 0) {
    $lines += "Looks healthy. Share the zip or compare to your last run in benchmark-history.html"
  }
  return $lines
}

function _LabelOrSuite($State) {
  if ($State.label) { return $State.label }
  return $State.suite
}

function Write-PlainEnglishSummary {
  param([string]$RunId, [hashtable]$State, [hashtable]$Metrics, [object]$CompareTo)
  $dir = Get-BenchmarkRunDir $RunId
  $path = Join-Path $dir "PLAIN-ENGLISH-SUMMARY.txt"
  $save = $Metrics["human_SAVE"]; $total = $Metrics["human_promptCount"]
  $saveRate = $Metrics["human_wouldSaveRate"]
  $lines = @(
    "KWALIFY BENCHMARK - PLAIN ENGLISH",
    "================================",
    "",
    "Run: $(_LabelOrSuite $State) ($RunId)",
    "Status: $($State.status)",
    ""
  )
  if ($total) {
    $lines += "You ran $total human prompts."
    if ($save -ne $null) { $lines += "$save would SAVE ($saveRate would-save rate)." }
    $lines += "SKIP: $($Metrics['human_SKIP'])  PARTIAL_OK: $($Metrics['human_PARTIAL_OK'])  Underfilled: $($Metrics['human_underfilledCount'])"
  }
  if ($CompareTo) {
    $lines += ""
    $lines += "vs last run ($($CompareTo.label)):"
    $delta = [math]::Round(([double]$saveRate - [double]$CompareTo.wouldSaveRate) * 100, 1)
    $sign = if ($delta -ge 0) { "+" } else { "" }
    $lines += "  Would-save rate: $sign$delta%"
  }
  $lines += ""
  $lines += "WHAT TO DO NEXT"
  foreach ($w in (Get-WhatToDoNext $Metrics)) { $lines += "  - $w" }
  Set-Content -LiteralPath $path -Value ($lines -join "`r`n") -Encoding UTF8
  return $path
}

function Write-BenchmarkHtmlReport {
  param([string]$RunId, [hashtable]$State, [hashtable]$Metrics, [string]$ShareText)
  $dir = Get-BenchmarkRunDir $RunId
  $out = Join-Path $dir "benchmark-report.html"
  $saveRate = if ($Metrics["human_wouldSaveRate"]) { [math]::Round([double]$Metrics["human_wouldSaveRate"] * 100, 1) } else { "?" }
  $next = (Get-WhatToDoNext $Metrics | ForEach-Object { "<li>$_</li>" }) -join ""
  $safeShare = ($ShareText -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;')
  $label = _LabelOrSuite $State
  $html = @"
<!DOCTYPE html><html><head><meta charset=utf-8><title>Benchmark $RunId</title>
<style>body{font-family:system-ui;background:#0f0a1a;color:#f3e8ff;padding:24px;max-width:800px}
.card{background:#1a1228;border:1px solid #3b2667;border-radius:12px;padding:20px;margin:16px 0}
.ok{color:#4ade80}pre{background:#12091f;padding:12px;border-radius:8px;white-space:pre-wrap}
</style></head><body>
<h1>Benchmark Report</h1>
<div class=card><p><strong>Run:</strong> $label</p>
<p><strong>Status:</strong> $($State.status)</p>
<p><strong>Would-save rate:</strong> <span class=ok>$saveRate%</span></p>
<p>SAVE: $($Metrics['human_SAVE']) | SKIP: $($Metrics['human_SKIP']) | Underfilled: $($Metrics['human_underfilledCount'])</p></div>
<div class=card><h2>Share text</h2><pre>$safeShare</pre></div>
<div class=card><h2>Next steps</h2><ul>$next</ul></div>
</body></html>
"@
  Set-Content -LiteralPath $out -Value $html -Encoding UTF8
  Copy-Item -LiteralPath $out -Destination (Join-Path $script:UxRoot "reports\benchmark-report-latest.html") -Force
  return $out
}

function Get-BenchmarkShareText {
  param([string]$RunId, [hashtable]$State, [hashtable]$Metrics)
  $saveRate = if ($Metrics["human_wouldSaveRate"]) { [math]::Round([double]$Metrics["human_wouldSaveRate"] * 100, 1) } else { "?" }
  return @(
    "Kwalify benchmark $RunId"
    "$(_LabelOrSuite $State) - $($State.status)"
    "Would-save: $saveRate% | SAVE: $($Metrics['human_SAVE']) | SKIP: $($Metrics['human_SKIP']) | Underfill: $($Metrics['human_underfilledCount'])"
    "Reports: reports\benchmark-runs\$RunId"
  ) -join "`n"
}

function Copy-BenchmarkShareText {
  param([string]$Text)
  try {
    Set-Clipboard -Value $Text
    Write-Ok "Copied summary to clipboard (paste in Discord/email)"
    return $true
  } catch { return $false }
}

function Send-BenchmarkNotification {
  param([string]$Title, [string]$Message, [switch]$Failed)
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $xml = @"
<toast><visual><binding template="ToastText02">
<text id="1">$Title</text>
<text id="2">$Message</text>
</binding></visual></toast>
"@
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Kwalify.Benchmark").Show((New-Object Windows.UI.Notifications.ToastNotification $doc))
  } catch {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.MessageBox]::Show($Message, $Title) | Out-Null
    } catch {}
  }
}

function Play-BenchmarkCompleteSound {
  param([switch]$Failed)
  try {
    [console]::beep($(if ($Failed) { 400 } else { 880 }), 300)
    Start-Sleep -Milliseconds 100
    [console]::beep($(if ($Failed) { 350 } else { 1100 }), 400)
  } catch {}
}

function Start-BenchmarkStuckWatch {
  param([string]$StatusFile, [int]$StallMinutes = 10)
  $warnFile = Join-Path $script:UxRoot "reports\benchmark-stuck-warning.txt"
  if (Test-Path $warnFile) { Remove-Item $warnFile -Force -ErrorAction SilentlyContinue }
  $script:StuckWatchJob = Start-Job -ScriptBlock {
    param($path, $stall, $warn)
    while ($true) {
      Start-Sleep -Seconds 60
      if (-not (Test-Path -LiteralPath $path)) { continue }
      $mtime = (Get-Item -LiteralPath $path).LastWriteTime
      if (((Get-Date) - $mtime).TotalMinutes -ge $stall) {
        "No progress for $stall minutes as of $(Get-Date)" | Set-Content -LiteralPath $warn -Encoding UTF8
        break
      }
    }
  } -ArgumentList $StatusFile, $StallMinutes, $warnFile
}

function Stop-BenchmarkStuckWatch {
  if ($script:StuckWatchJob) {
    Stop-Job $script:StuckWatchJob -ErrorAction SilentlyContinue
    Remove-Job $script:StuckWatchJob -Force -ErrorAction SilentlyContinue
    $script:StuckWatchJob = $null
  }
}

function Test-ShouldShowWeeklyGuide {
  if (-not (Test-Path -LiteralPath $script:GuideFlagPath)) { return $true }
  $shown = (Get-Item -LiteralPath $script:GuideFlagPath).LastWriteTime
  return ((Get-Date) - $shown).TotalDays -ge 7
}

function Mark-GuideShown {
  $dir = Split-Path $script:GuideFlagPath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Set-Content -LiteralPath $script:GuideFlagPath -Value (Get-Date).ToString("o") -Encoding UTF8
}

function Show-RunPreview {
  param([hashtable]$Meta, [int]$PromptCount, [string]$RotationNote = "")
  $eta = Get-BenchmarkEtaText $PromptCount
  $label = if ($Meta.label) { $Meta.label } else { $Meta.suite }
  Write-Host ""
  Write-Host "  ABOUT TO RUN" -ForegroundColor Cyan
  Write-Host "  $label"
  Write-Host "  Prompts: $PromptCount  (~$($eta.minutes) min, done ~$($eta.doneAt))"
  if ($RotationNote) { Write-Host "  $RotationNote" -ForegroundColor DarkGray }
  if ($Meta.variety -eq "on") { Write-Host "  Generation variety: on (different playlists if a prompt repeats)" -ForegroundColor DarkGray }
  Write-Host "  Cost: local only (no Cursor credits)"
  Write-Host ""
}

function Open-BenchmarkResultsFolder {
  $reports = Join-Path $script:UxRoot "reports"
  if (-not (Test-Path $reports)) { New-Item -ItemType Directory -Force -Path $reports | Out-Null }
  Start-Process explorer.exe $reports | Out-Null
}

function Finalize-BenchmarkUx {
  param(
    [string]$RunId,
    [hashtable]$State,
    [object]$ExitCode,
    [hashtable]$Metrics,
    [hashtable]$Choice = @{}
  )
  if ($ExitCode -is [System.Array]) { $ExitCode = [int]$ExitCode[$ExitCode.Count - 1] }
  else { $ExitCode = [int]$ExitCode }
  Stop-BenchmarkStuckWatch
  $prev = $null
  if (Test-Path -LiteralPath $script:HistoryPath) {
    try {
      $hist = @(Get-Content -LiteralPath $script:HistoryPath -Raw | ConvertFrom-Json)
      if ($hist.Count -gt 0) { $prev = $hist[0] }
    } catch {}
  }
  Write-PlainEnglishSummary -RunId $RunId -State $State -Metrics $Metrics -CompareTo $prev | Out-Null
  $share = Get-BenchmarkShareText -RunId $RunId -State $State -Metrics $Metrics
  Write-BenchmarkHtmlReport -RunId $RunId -State $State -Metrics $Metrics -ShareText $share | Out-Null
  Copy-BenchmarkShareText $share | Out-Null
  $saveRate = $Metrics["human_wouldSaveRate"]
  Add-BenchmarkHistoryEntry @{
    runId = $RunId
    label = _LabelOrSuite $State
    status = $State.status
    finishedAt = (Get-Date).ToUniversalTime().ToString("o")
    wouldSaveRate = $saveRate
    SAVE = $Metrics["human_SAVE"]
    SKIP = $Metrics["human_SKIP"]
    promptCount = $Metrics["human_promptCount"]
    exitCode = $ExitCode
  }
  if ($Choice.Count -gt 0) { Save-BenchmarkLastChoice $Choice }
  $lbl = _LabelOrSuite $State
  if ($ExitCode -eq 0) {
    $pct = if ($saveRate) { [math]::Round([double]$saveRate * 100, 1) } else { "?" }
    Send-BenchmarkNotification "Benchmark complete" "$lbl - SAVE rate $pct%"
    Play-BenchmarkCompleteSound
  } else {
    Send-BenchmarkNotification "Benchmark failed" "See kwalify-benchmark.log" -Failed
    Play-BenchmarkCompleteSound -Failed
  }
}
