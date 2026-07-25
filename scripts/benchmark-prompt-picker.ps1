# Interactive prompt selection for human-keep benchmarks.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

. "$PSScriptRoot\benchmark-prompt-rotation.ps1" -Root $Root

function Get-CohortForPrompt($p) {
  if ($p.difficulty -eq "hard") { return "guided" }
  if ($p.difficulty -eq "edge" -and $p.family -eq "vague") { return "vague" }
  if ($p.prompt -match '(?i)(like |vibes but|Queens of the Stone Age|Phoebe Bridgers|ABBA|The Cure|Boards of Canada)') { return "guided" }
  if ($p.difficulty -eq "edge") { return "vague" }
  if (@("walk", "mood", "chore", "vague") -contains $p.family -and $p.difficulty -eq "easy") { return "vague" }
  if ($p.id -eq "h100") { return "guided" }
  if ($p.difficulty -eq "medium" -and $p.prompt -match '(?i)(grunge|goth|disco|metal|ukg|grime|shoegaze|britpop|jazz|latin)') { return "guided" }
  return "vague"
}

function Get-HumanPromptCatalog {
  $ts = Join-Path $Root "backend\scripts\human-100-prompts.ts"
  if (-not (Test-Path -LiteralPath $ts)) { return @() }
  $catalog = @()
  foreach ($line in Get-Content -LiteralPath $ts) {
    if ($line -notmatch '^\s*\{ id: "h\d+"') { continue }
    if ($line -match 'id: "(h\d+)", prompt: "([^"]+)", mode: "[^"]+", length: \d+, difficulty: "(easy|medium|hard|edge)", family: "([^"]+)"') {
      $row = [pscustomobject]@{
        id = $Matches[1]
        prompt = $Matches[2]
        difficulty = $Matches[3]
        family = $Matches[4]
      }
      $row | Add-Member -NotePropertyName cohort -NotePropertyValue (Get-CohortForPrompt $row)
      $catalog += $row
    }
  }
  return $catalog
}

function Get-HumanOnlyCatalog([array]$Catalog) {
  return @($Catalog | Where-Object { $_.cohort -eq "vague" })
}

function Get-TierCounts([array]$catalog) {
  $counts = @{ easy = 0; medium = 0; hard = 0; edge = 0 }
  foreach ($p in $catalog) { $counts[$p.difficulty]++ }
  return $counts
}

function Get-StratifiedPromptIds {
  param([array]$Catalog, [int]$Total)
  if ($Catalog.Count -eq 0) { return "" }
  $tiers = @("easy", "medium", "hard", "edge")
  $want = @{}
  $base = [math]::Floor($Total / $tiers.Count)
  $extra = $Total % $tiers.Count
  for ($i = 0; $i -lt $tiers.Count; $i++) {
    $want[$tiers[$i]] = $base + ($(if ($i -lt $extra) { 1 } else { 0 }))
  }
  $picked = @()
  foreach ($tier in $tiers) {
    $pool = $Catalog | Where-Object { $_.difficulty -eq $tier } | Sort-Object { Get-Random }
    $take = [math]::Min($want[$tier], $pool.Count)
    if ($take -gt 0) { $picked += @($pool | Select-Object -First $take | ForEach-Object { $_.id }) }
  }
  while ($picked.Count -lt $Total) {
    $next = $Catalog | Where-Object { $picked -notcontains $_.id } | Sort-Object { Get-Random } | Select-Object -First 1
    if (-not $next) { break }
    $picked += $next.id
  }
  return ($picked -join ",")
}

function Show-PromptSamples {
  param([array]$Catalog, [string]$Tier = "", [int]$Max = 5)
  $rows = if ($Tier) { $Catalog | Where-Object { $_.difficulty -eq $Tier } } else { $Catalog }
  foreach ($p in ($rows | Select-Object -First $Max)) {
    $short = if ($p.prompt.Length -gt 52) { $p.prompt.Substring(0, 49) + "..." } else { $p.prompt }
    Write-Host ("    {0}  {1}" -f $p.id, $short) -ForegroundColor DarkGray
  }
  $left = @($rows).Count - $Max
  if ($left -gt 0) { Write-Host ("    ... and {0} more" -f $left) -ForegroundColor DarkGray }
}

function Read-CountOrDefault([string]$label, [int]$default, [int]$max) {
  $raw = Read-Host ("  {0} [{1}]" -f $label, $default)
  if (-not $raw) { return $default }
  $n = 0
  if ([int]::TryParse($raw.Trim(), [ref]$n)) {
    return [math]::Max(0, [math]::Min($n, $max))
  }
  return $default
}

function Pick-IdsFromCustomMix {
  param([array]$Catalog, [int]$Total)
  $tierCounts = Get-TierCounts $Catalog
  Write-Host ""
  Write-Host ("  CUSTOM MIX ({0} prompts total)" -f $Total) -ForegroundColor Cyan
  Write-Host "  Available: easy=$($tierCounts.easy) medium=$($tierCounts.medium) hard=$($tierCounts.hard) edge=$($tierCounts.edge)"
  Write-Host "  Press Enter on each line for a balanced default split."
  Write-Host "  Prompts rotate each run - tier counts stay the same." -ForegroundColor DarkGray
  Write-Host ""
  $defaults = @{
    easy = [math]::Max(1, [math]::Round($Total * 0.24))
    medium = [math]::Max(1, [math]::Round($Total * 0.36))
    hard = [math]::Max(1, [math]::Round($Total * 0.24))
    edge = [math]::Max(0, $Total - [math]::Round($Total * 0.24) - [math]::Round($Total * 0.36) - [math]::Round($Total * 0.24))
  }
  $want = @{
    easy = Read-CountOrDefault "Easy" $defaults.easy $tierCounts.easy
    medium = Read-CountOrDefault "Medium" $defaults.medium $tierCounts.medium
    hard = Read-CountOrDefault "Hard" $defaults.hard $tierCounts.hard
    edge = Read-CountOrDefault "Edge" $defaults.edge $tierCounts.edge
  }
  $sum = ($want.Values | Measure-Object -Sum).Sum
  if ($sum -ne $Total) {
    Write-Host ("  Adjusted to {0} prompts (you asked for {1})." -f $sum, $Total) -ForegroundColor Yellow
  }
  return @{
    tierMix = $want
    total = $sum
  }
}

function Pick-IdsByPromptEntry {
  param([array]$Catalog)
  Write-Host ""
  Write-Host "  PICK PROMPTS BY ID" -ForegroundColor Cyan
  foreach ($tier in @("easy", "medium", "hard", "edge")) {
    Write-Host ""
    Write-Host "  $tier" -ForegroundColor White
    Show-PromptSamples -Catalog $Catalog -Tier $tier -Max 4
  }
  Write-Host ""
  $raw = Read-Host "  Enter IDs (comma-separated, e.g. h03,h12,h65)"
  if (-not $raw) { return "" }
  $valid = @($Catalog | ForEach-Object { $_.id })
  $picked = @($raw -split '[,\s]+' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -and ($valid -contains $_) })
  return ($picked -join ",")
}

function Get-RecommendedHumanConfig {
  param([int]$Size = 50)
  return @{
    suite = "human"; limit = $Size; variety = $true; humanOnly = $true; package = $true
    presetKey = "human-only-$Size"
    label = "Human only ($Size) [recommended, rotates each run]"
  }
}

function Restore-LastBenchmarkChoice {
  $last = Get-BenchmarkLastChoice
  if (-not $last) { return $null }
  $cfg = @{
    suite = [string]$last.suite
    limit = [int]$last.limit
    label = [string]$last.label
    variety = if ($null -ne $last.variety) { [bool]$last.variety } else { $true }
    package = [bool]$last.package
    noMenu = $true
  }
  if ($last.presetKey) { $cfg.presetKey = [string]$last.presetKey }
  if ($last.humanOnly) { $cfg.humanOnly = [bool]$last.humanOnly }
  if ($last.fullMix) { $cfg.fullMix = [bool]$last.fullMix }
  if ($last.freezeIds) { $cfg.freezeIds = [bool]$last.freezeIds }
  if ($last.cohort) { $cfg.cohort = [string]$last.cohort }
  if ($last.difficulty) { $cfg.difficulty = [string]$last.difficulty }
  if ($last.tierMix) {
    $cfg.tierMix = @{
      easy = [int]$last.tierMix.easy
      medium = [int]$last.tierMix.medium
      hard = [int]$last.tierMix.hard
      edge = [int]$last.tierMix.edge
    }
  }
  if ($last.freezeIds -or $last.presetKey -eq "hand-picked") {
    if ($last.ids) { $cfg.ids = [string]$last.ids }
    $cfg.freezeIds = $true
  }
  if ($cfg.label -notmatch "rotates") {
    $cfg.label = ($cfg.label + " [rotates each run]").Trim()
  }
  return $cfg
}

function Read-CustomPromptCount {
  param([int]$Default = 50, [int]$Max = 100)
  Write-Host ""
  Write-Host "  CUSTOM PROMPT COUNT" -ForegroundColor Cyan
  Write-Host "  How many prompts? (1-$Max, default $Default)"
  $raw = Read-Host "  Count"
  if (-not $raw) { return $Default }
  $n = 0
  if ([int]::TryParse($raw.Trim(), [ref]$n)) {
    return [math]::Max(1, [math]::Min($n, $Max))
  }
  return $Default
}

function Show-PromptPickerMenu {
  param([int]$Size = 25)

  $catalog = Get-HumanPromptCatalog
  if ($catalog.Count -eq 0) {
    Write-Host "  Could not load prompt catalog." -ForegroundColor Red
    return $null
  }

  $label = switch ($Size) {
    25 { "SMALL" }
    50 { "MEDIUM" }
    100 { "LONG" }
    default { "$Size" }
  }

  while ($true) {
    Write-Host ""
    Write-Host ("  {0} BENCHMARK ({1} prompts)" -f $label, $Size) -ForegroundColor Magenta
    Write-Host "  Presets rotate prompts each run (except Pick by ID)." -ForegroundColor DarkGray
    Write-Host ""
    $humanOnly = Get-HumanOnlyCatalog $catalog
    Write-Host "  [1] Human only (recommended)  natural wording, no genre/artist locks"
    Show-PromptSamples -Catalog $humanOnly -Max 3
    Write-Host "  [2] Full mix                  includes guided genre-lock prompts too"
    Write-Host "  [3] Short & easy              easy human prompts (quick sanity)"
    Write-Host "  [4] Custom mix                you choose how many per tier (human only)"
    Write-Host "  [5] Pick by ID                fixed list - same IDs every time"
    Write-Host "  [6] Single tier               easy / medium / hard / edge only"
    Write-Host ""
    Write-Host "  [b] Back"
    Write-Host ""
    $choice = (Read-Host "  Your choice").Trim().ToLower()
    if (-not $choice) { $choice = "1" }

    switch ($choice) {
      "b" { return $null }
      "1" {
        return @{
          suite = "human"; limit = $Size; variety = $true; humanOnly = $true
          presetKey = "human-only-$Size"
          label = "Human only ($Size) [rotates each run]"
        }
      }
      "2" {
        return @{
          suite = "human"; limit = $Size; variety = $true; fullMix = $true
          presetKey = "full-mix-$Size"
          label = "Full mix ($Size) [rotates each run]"
        }
      }
      "3" {
        $easyMax = @($humanOnly | Where-Object { $_.difficulty -eq "easy" }).Count
        $n = [math]::Min($Size, $easyMax)
        return @{
          suite = "human"; limit = $n; cohort = "vague"; difficulty = "easy"; variety = $true; humanOnly = $true
          presetKey = "easy-only-$n"
          label = "Human only, easy ($n) [rotates each run]"
        }
      }
      "4" {
        $mix = Pick-IdsFromCustomMix -Catalog $humanOnly -Total $Size
        if (-not $mix) { continue }
        $tm = $mix.tierMix
        return @{
          suite = "human"; limit = $mix.total; variety = $true; humanOnly = $true
          tierMix = $tm
          presetKey = ("custom-mix-{0}-e{1}-m{2}-h{3}-x{4}" -f $mix.total, $tm.easy, $tm.medium, $tm.hard, $tm.edge)
          label = "Human custom mix ($($mix.total)) [rotates each run]"
        }
      }
      "5" {
        $ids = Pick-IdsByPromptEntry -Catalog $humanOnly
        if (-not $ids) { Write-Host "  No valid IDs entered." -ForegroundColor Yellow; continue }
        $count = @($ids -split ",").Count
        return @{
          suite = "human"; limit = $count; ids = $ids; variety = $true; humanOnly = $true
          presetKey = "hand-picked"; freezeIds = $true
          label = "Hand-picked ($count) [fixed IDs]"
        }
      }
      "6" {
        Write-Host ""
        Write-Host "  [e] Easy  [m] Medium  [h] Hard  [x] Edge  (human-only pool)"
        $tierPick = (Read-Host "  Tier").Trim().ToLower()
        $tier = switch ($tierPick) {
          "e" { "easy" } "easy" { "easy" }
          "m" { "medium" } "medium" { "medium" }
          "h" { "hard" } "hard" { "hard" }
          "x" { "edge" } "edge" { "edge" }
          default { $null }
        }
        if (-not $tier) { Write-Host "  Unknown tier." -ForegroundColor Yellow; continue }
        $tierMax = @($humanOnly | Where-Object { $_.difficulty -eq $tier }).Count
        if ($tierMax -eq 0) {
          Write-Host "  No human-only prompts in tier '$tier'. Try full mix [2]." -ForegroundColor Yellow
          continue
        }
        $n = [math]::Min($Size, $tierMax)
        return @{
          suite = "human"; limit = $n; cohort = "vague"; difficulty = $tier; variety = $true; humanOnly = $true
          presetKey = "tier-$tier-$n"
          label = "Human only, $tier ($n) [rotates each run]"
        }
      }
      default { Write-Host "  Pick 1-6 or b." -ForegroundColor Yellow }
    }
  }
}

function Show-BenchmarkMainMenu {
  while ($true) {
    Write-Host ""
    Write-Host "  HUMAN PROMPT BENCHMARK" -ForegroundColor Magenta
    Write-Host "  As easy as asking an assistant - as custom as you need" -ForegroundColor DarkGray
    $last = Get-BenchmarkLastChoice
    $saved = Get-SavedBenchmarkPresets
    if ($last -and $last.label) {
      Write-Host ""
      Write-Host ("  [r] Same preset as last time: {0}" -f $last.label) -ForegroundColor Green
      Write-Host '      (fresh prompt rotation - not the same IDs)' -ForegroundColor DarkGray
    }
    if ($saved.Count -gt 0) {
      Write-Host ("  [s] Saved presets ({0})" -f $saved.Count) -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "  QUICKEST" -ForegroundColor Cyan
    Write-Host "  [Enter] Quick Run wizard   customise count + style on one screen"
    Write-Host "  [g] Go now               50 human-only, rotates, zip (~2h, no questions)"
    Write-Host ""
    Write-Host "  PRESETS (then pick prompt style)"
    Write-Host "  [1] Small   25 prompts   (~1h)    [2] Medium  50   (~2h)    [3] Long 100 (~4h)"
    Write-Host ""
    Write-Host "  TOOLS"
    Write-Host "  [4] Smoke   [5] Status   [6] Package   [7] Guide   [8] History   [m] More"
    Write-Host ""
    $choice = (Read-Host "  Choice (Enter = Quick Run wizard)").Trim().ToLower()

    switch ($choice) {
      "" {
        $cfg = Show-QuickRunWizard
        if ($cfg) { return $cfg }
      }
      "q" {
        $cfg = Show-QuickRunWizard
        if ($cfg) { return $cfg }
      }
      "g" { return (Get-RecommendedHumanConfig -Size 50) }
      "go" { return (Get-RecommendedHumanConfig -Size 50) }
      "r" {
        $cfg = Restore-LastBenchmarkChoice
        if ($cfg) { return $cfg }
        Write-Host "  Could not restore last choice." -ForegroundColor Yellow
      }
      "s" {
        $cfg = Show-SavedPresetsMenu
        if ($cfg) { return $cfg }
      }
      "1" {
        $cfg = Show-PromptPickerMenu -Size 25
        if ($cfg) { return $cfg }
      }
      "2" {
        $cfg = Show-PromptPickerMenu -Size 50
        if ($cfg) { return $cfg }
      }
      "medium" {
        $cfg = Show-PromptPickerMenu -Size 50
        if ($cfg) { return $cfg }
      }
      "small" {
        $cfg = Show-PromptPickerMenu -Size 25
        if ($cfg) { return $cfg }
      }
      "3" {
        $cfg = Show-PromptPickerMenu -Size 100
        if ($cfg) { return $cfg }
      }
      "long" {
        $cfg = Show-PromptPickerMenu -Size 100
        if ($cfg) { return $cfg }
      }
      "large" {
        $cfg = Show-PromptPickerMenu -Size 100
        if ($cfg) { return $cfg }
      }
      "full" {
        $cfg = Show-PromptPickerMenu -Size 100
        if ($cfg) { return $cfg }
      }
      "4" { return @{ suite = "smoke"; label = "Smoke test" } }
      "5" { return @{ suite = "status"; label = "Status" } }
      "6" { return @{ suite = "package"; label = "Package" } }
      "7" { return @{ suite = "guide"; label = "Guide" } }
      "8" { return @{ suite = "history"; label = "History" } }
      "?" { return @{ suite = "guide"; label = "Guide" } }
      "help" { return @{ suite = "help"; label = "Help" } }
      "m" { return @{ suite = "_more"; label = "More" } }
      "smoke" { return @{ suite = "smoke"; label = "Smoke test" } }
      "status" { return @{ suite = "status"; label = "Status" } }
      "package" { return @{ suite = "package"; label = "Package" } }
      default { Write-Host "  Pick 1-6, m, or a suite name." -ForegroundColor Yellow }
    }
  }
}
