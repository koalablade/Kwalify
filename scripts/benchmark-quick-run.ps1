# Quick Run wizard, natural-language CLI, and named saved presets.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$script:SavedPresetsPath = Join-Path $Root "reports\benchmark-saved-presets.json"

function Read-FieldOrDefault {
  param([string]$Prompt, [string]$Default)
  $raw = Read-Host $Prompt
  if (-not $raw) { return $Default }
  return $raw.Trim()
}

function Read-IntOrDefault {
  param([string]$Prompt, [int]$Default, [int]$Min = 1, [int]$Max = 100)
  $raw = Read-Host $Prompt
  if (-not $raw) { return $Default }
  $n = 0
  if ([int]::TryParse($raw.Trim(), [ref]$n)) {
    return [math]::Max($Min, [math]::Min($n, $Max))
  }
  return $Default
}

function Get-SavedBenchmarkPresets {
  if (-not (Test-Path -LiteralPath $script:SavedPresetsPath)) { return @{} }
  try {
    $raw = Get-Content -LiteralPath $script:SavedPresetsPath -Raw | ConvertFrom-Json
    $out = @{}
    $raw.PSObject.Properties | ForEach-Object { $out[$_.Name] = $_.Value }
    return $out
  } catch { return @{} }
}

function Save-NamedBenchmarkPreset {
  param([string]$Name, [hashtable]$Cfg)
  $name = $Name.Trim().ToLower() -replace '[^a-z0-9\-]+', '-'
  if (-not $name) { return $false }
  $all = Get-SavedBenchmarkPresets
  $entry = @{
    label = $Cfg.label
    suite = $Cfg.suite
    limit = [int]$Cfg.limit
    presetKey = $Cfg.presetKey
    humanOnly = [bool]$Cfg.humanOnly
    fullMix = [bool]$Cfg.fullMix
    variety = if ($null -ne $Cfg.variety) { [bool]$Cfg.variety } else { $true }
    package = [bool]$Cfg.package
    savedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  if ($Cfg.cohort) { $entry.cohort = [string]$Cfg.cohort }
  if ($Cfg.difficulty) { $entry.difficulty = [string]$Cfg.difficulty }
  if ($Cfg.tierMix) { $entry.tierMix = $Cfg.tierMix }
  if ($Cfg.freezeIds) { $entry.freezeIds = $true; $entry.ids = [string]$Cfg.ids }
  $all[$name] = $entry
  $dir = Split-Path $script:SavedPresetsPath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $all | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:SavedPresetsPath -Encoding UTF8
  return $true
}

function Get-NamedBenchmarkPreset([string]$Name) {
  $key = $Name.Trim().ToLower()
  $all = Get-SavedBenchmarkPresets
  if (-not $all.ContainsKey($key)) { return $null }
  $p = $all[$key]
  $cfg = @{
    suite = if ($p.suite) { [string]$p.suite } else { "human" }
    limit = [int]$p.limit
    label = [string]$p.label
    variety = if ($null -ne $p.variety) { [bool]$p.variety } else { $true }
    package = [bool]$p.package
    noMenu = $true
  }
  if ($p.presetKey) { $cfg.presetKey = [string]$p.presetKey }
  if ($p.humanOnly) { $cfg.humanOnly = $true }
  if ($p.fullMix) { $cfg.fullMix = $true }
  if ($p.cohort) { $cfg.cohort = [string]$p.cohort }
  if ($p.difficulty) { $cfg.difficulty = [string]$p.difficulty }
  if ($p.freezeIds) { $cfg.freezeIds = $true; $cfg.ids = [string]$p.ids }
  if ($p.tierMix) {
    $cfg.tierMix = @{
      easy = [int]$p.tierMix.easy
      medium = [int]$p.tierMix.medium
      hard = [int]$p.tierMix.hard
      edge = [int]$p.tierMix.edge
    }
  }
  return $cfg
}

function Show-SavedPresetsMenu {
  $all = Get-SavedBenchmarkPresets
  if ($all.Count -eq 0) {
    Write-Host "  No saved presets yet. Use Quick Run [q] and save at the end." -ForegroundColor Yellow
    return $null
  }
  Write-Host ""
  Write-Host "  SAVED PRESETS" -ForegroundColor Cyan
  $i = 1
  $keys = @($all.Keys | Sort-Object)
  foreach ($k in $keys) {
    $p = $all[$k]
    Write-Host ("  [{0}] {1} - {2}" -f $i, $k, $p.label)
    $i++
  }
  Write-Host "  [b] Back"
  Write-Host ""
  $pick = (Read-Host "  Pick preset").Trim().ToLower()
  if ($pick -eq "b") { return $null }
  $n = 0
  if ([int]::TryParse($pick, [ref]$n) -and $n -ge 1 -and $n -le $keys.Count) {
    return Get-NamedBenchmarkPreset $keys[$n - 1]
  }
  if ($all.ContainsKey($pick)) { return Get-NamedBenchmarkPreset $pick }
  Write-Host "  Unknown preset." -ForegroundColor Yellow
  return $null
}

function Build-HumanBenchmarkConfig {
  param(
    [int]$Count = 50,
    [string]$Style = "human",
    [hashtable]$TierMix = $null,
    [string]$Ids = "",
    [string]$Tier = "",
    [switch]$Package
  )
  $count = [math]::Max(1, [math]::Min($Count, 100))
  $doPackage = [bool]$Package -or $count -ge 50

  if ($Ids) {
    $idList = @($Ids -split '[,\s]+' | Where-Object { $_ })
    return @{
      suite = "human"; limit = $idList.Count; ids = ($idList -join ",")
      variety = $true; humanOnly = $true; freezeIds = $true
      presetKey = "hand-picked"; package = $doPackage
      label = "Hand-picked ($($idList.Count)) [fixed IDs]"
    }
  }

  if ($TierMix) {
    $tm = $TierMix
    $sum = $tm.easy + $tm.medium + $tm.hard + $tm.edge
    return @{
      suite = "human"; limit = $sum; variety = $true; humanOnly = $true
      tierMix = $tm; package = $doPackage
      presetKey = ("custom-mix-{0}-e{1}-m{2}-h{3}-x{4}" -f $sum, $tm.easy, $tm.medium, $tm.hard, $tm.edge)
      label = "Human custom mix ($sum) [rotates each run]"
    }
  }

  switch ($Style.ToLower()) {
    { $_ -in @("mix", "full", "full-mix") } {
      return @{
        suite = "human"; limit = $count; variety = $true; fullMix = $true; package = $doPackage
        presetKey = "full-mix-$count"
        label = "Full mix ($count) [rotates each run]"
      }
    }
    "easy" {
      return @{
        suite = "human"; limit = $count; cohort = "vague"; difficulty = "easy"
        variety = $true; humanOnly = $true; package = $doPackage
        presetKey = "easy-only-$count"
        label = "Human only, easy ($count) [rotates each run]"
      }
    }
    { $_ -in @("medium", "hard", "edge") } {
      return @{
        suite = "human"; limit = $count; cohort = "vague"; difficulty = $Style.ToLower()
        variety = $true; humanOnly = $true; package = $doPackage
        presetKey = "tier-$($Style.ToLower())-$count"
        label = "Human only, $($Style.ToLower()) ($count) [rotates each run]"
      }
    }
    default {
      return @{
        suite = "human"; limit = $count; variety = $true; humanOnly = $true; package = $doPackage
        presetKey = "human-only-$count"
        label = "Human only ($count) [rotates each run]"
      }
    }
  }
}

function Parse-NaturalBenchmarkRequest {
  param([string]$Request)
  if (-not $Request) { return $null }
  $text = $Request.Trim().ToLower()
  if (-not $text) { return $null }

  $saved = Get-NamedBenchmarkPreset $text
  if ($saved) { return $saved }

  $core = ($text -replace '\b(yes|go|now|package)\b', '').Trim()
  if (-not $core) { $core = $text }

  switch ($core) {
    "go" { return (Get-RecommendedHumanConfig -Size 50) }
    "recommended" { return (Get-RecommendedHumanConfig -Size 50) }
    "small" { return (Build-HumanBenchmarkConfig -Count 25 -Style human -Package) }
    "medium" { return (Build-HumanBenchmarkConfig -Count 50 -Style human -Package) }
    "long" { return (Build-HumanBenchmarkConfig -Count 100 -Style human -Package) }
    "large" { return (Build-HumanBenchmarkConfig -Count 100 -Style human -Package) }
  }

  if ($core -match '^h\d' -or $text -match '^h\d') {
    $ids = ($text -split '[,\s]+' | Where-Object { $_ -match '^h\d' }) -join ","
    return Build-HumanBenchmarkConfig -Ids $ids -Package
  }

  $count = 50
  $style = "human"
  $tierMix = $null
  $package = $text -match '\b(yes|go|now|package)\b'

  if ($text -match '\b(\d{1,3})\b') { $count = [int]$Matches[1] }

  if ($text -match '\b(full[\-\s]?mix|mix)\b') { $style = "full" }
  elseif ($text -match '\b(easy|medium|hard|edge)\b') { $style = $Matches[1] }

  if ($text -match '\b(\d{1,2})\s*[,/]\s*(\d{1,2})\s*[,/]\s*(\d{1,2})\s*[,/]\s*(\d{1,2})\b') {
    $tierMix = @{
      easy = [int]$Matches[1]; medium = [int]$Matches[2]
      hard = [int]$Matches[3]; edge = [int]$Matches[4]
    }
    $count = ($tierMix.Values | Measure-Object -Sum).Sum
    return Build-HumanBenchmarkConfig -TierMix $tierMix -Package:$package
  }

  if ($text -match '\bids?\s*[:=]?\s*([h\d,\s]+)') {
    return Build-HumanBenchmarkConfig -Ids ($Matches[1] -replace '\s+', ',') -Package:$package
  }

  $cfg = Build-HumanBenchmarkConfig -Count $count -Style $style -Package:$package
  $cfg.noMenu = $package
  return $cfg
}

function Show-QuickRunWizard {
  $last = Get-BenchmarkLastChoice
  $defaultCount = if ($last -and $last.limit) { [int]$last.limit } else { 50 }

  Write-Host ""
  Write-Host "  QUICK RUN - set it up like talking to an assistant" -ForegroundColor Magenta
  Write-Host "  Press Enter on each line to accept the default." -ForegroundColor DarkGray
  Write-Host ""

  $count = Read-IntOrDefault ("  How many prompts? [1-100, default {0}]" -f $defaultCount) $defaultCount
  $eta = Get-BenchmarkEtaText $count
  Write-Host ("  ~{0} min, done around {1}" -f $eta.minutes, $eta.doneAt) -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "  Prompt style:"
  Write-Host "    [1] Human only (recommended) - natural wording, rotates each run"
  Write-Host "    [2] Full mix - includes genre-lock prompts, rotates"
  Write-Host "    [3] Easy only - quick sanity, rotates"
  Write-Host "    [4] Custom tier split - you set easy/medium/hard/edge counts"
  Write-Host "    [5] Pick exact IDs - fixed list (h03,h12,...)"
  Write-Host "    [6] Single tier - only easy OR medium OR hard OR edge"
  $stylePick = Read-FieldOrDefault "  Style [1]" "1"

  $cfg = $null
  switch ($stylePick) {
    "2" { $cfg = Build-HumanBenchmarkConfig -Count $count -Style full }
    "3" { $cfg = Build-HumanBenchmarkConfig -Count $count -Style easy }
    "4" {
      $humanOnly = Get-HumanOnlyCatalog (Get-HumanPromptCatalog)
      $mix = Pick-IdsFromCustomMix -Catalog $humanOnly -Total $count
      if ($mix) {
        $tm = $mix.tierMix
        $cfg = Build-HumanBenchmarkConfig -TierMix $tm
      }
    }
    "5" {
      $humanOnly = Get-HumanOnlyCatalog (Get-HumanPromptCatalog)
      $ids = Pick-IdsByPromptEntry -Catalog $humanOnly
      if ($ids) { $cfg = Build-HumanBenchmarkConfig -Ids $ids }
    }
    "6" {
      $tier = Read-FieldOrDefault "  Tier (easy/medium/hard/edge) [easy]" "easy"
      $cfg = Build-HumanBenchmarkConfig -Count $count -Style $tier
    }
    default { $cfg = Build-HumanBenchmarkConfig -Count $count -Style human }
  }
  if (-not $cfg) { return $null }

  $pkgDefault = if ($count -ge 50) { "Y" } else { "n" }
  $pkgAns = Read-FieldOrDefault ("  Zip results to Desktop when done? [{0}/n]" -f $pkgDefault) $pkgDefault
  $cfg.package = ($pkgAns.Trim().ToLower() -notin @("n", "no"))

  Write-Host ""
  Write-Host ("  Ready: {0}" -f $cfg.label) -ForegroundColor Cyan
  $saveAns = Read-FieldOrDefault "  Save as named preset for next time? (name or Enter to skip)" ""
  if ($saveAns) {
    if (Save-NamedBenchmarkPreset -Name $saveAns -Cfg $cfg) {
      Write-Host ("  Saved as '{0}' - run: start-kwalify-benchmark.bat run {0} yes" -f ($saveAns.Trim().ToLower() -replace '[^a-z0-9\-]+', '-')) -ForegroundColor Green
    }
  }

  $go = Read-FieldOrDefault "  Start now? [Y/n]" "Y"
  if ($go.Trim().ToLower() -in @("n", "no")) { return $null }
  $cfg.noMenu = $true

  return $cfg
}
