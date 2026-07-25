# Prompt rotation: same preset profile picks fresh prompts each run.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$script:RotationPath = Join-Path $Root "reports\benchmark-prompt-rotation.json"
$script:RotationMaxRuns = 3

function Get-PromptRotationStore {
  if (-not (Test-Path -LiteralPath $script:RotationPath)) {
    return @{ version = 1; profiles = @{} }
  }
  try {
    $raw = Get-Content -LiteralPath $script:RotationPath -Raw | ConvertFrom-Json
    $profiles = @{}
    if ($raw.profiles) {
      $raw.profiles.PSObject.Properties | ForEach-Object {
        $profiles[$_.Name] = @($_.Value)
      }
    }
    return @{ version = 1; profiles = $profiles }
  } catch {
    return @{ version = 1; profiles = @{} }
  }
}

function Save-PromptRotationStore([hashtable]$Store) {
  $dir = Split-Path $script:RotationPath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $out = @{ version = 1; profiles = $Store.profiles }
  $out | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:RotationPath -Encoding UTF8
}

function Get-RecentlyUsedPromptIds {
  param([string]$PresetKey, [int]$MaxRuns = $script:RotationMaxRuns)
  if (-not $PresetKey) { return @() }
  $store = Get-PromptRotationStore
  if (-not $store.profiles.ContainsKey($PresetKey)) { return @() }
  $used = @()
  foreach ($run in @($store.profiles[$PresetKey] | Select-Object -First $MaxRuns)) {
    if ($run.ids) { $used += @($run.ids) }
  }
  return @($used | Select-Object -Unique)
}

function Record-BenchmarkPromptRotation {
  param([string]$PresetKey, [string[]]$Ids, [string]$RunId)
  if (-not $PresetKey -or $PresetKey -eq "hand-picked" -or -not $Ids -or $Ids.Count -eq 0) { return }
  $store = Get-PromptRotationStore
  $entry = @{
    runId = $RunId
    ids = @($Ids)
    at = (Get-Date).ToUniversalTime().ToString("o")
  }
  $prev = @()
  if ($store.profiles.ContainsKey($PresetKey)) { $prev = @($store.profiles[$PresetKey]) }
  $store.profiles[$PresetKey] = ,$entry + @($prev | Select-Object -First ($script:RotationMaxRuns - 1))
  Save-PromptRotationStore $store
}

function Get-RotatedStratifiedPromptIds {
  param(
    [array]$Catalog,
    [int]$Total,
    [string]$PresetKey,
    [hashtable]$TierWant = $null
  )
  if ($Catalog.Count -eq 0) { return "" }
  $recent = @(Get-RecentlyUsedPromptIds -PresetKey $PresetKey)
  $tiers = @("easy", "medium", "hard", "edge")
  $want = @{}
  if ($TierWant) {
    $want = $TierWant.Clone()
  } else {
    $base = [math]::Floor($Total / $tiers.Count)
    $extra = $Total % $tiers.Count
    for ($i = 0; $i -lt $tiers.Count; $i++) {
      $want[$tiers[$i]] = $base + ($(if ($i -lt $extra) { 1 } else { 0 }))
    }
  }
  $picked = @()
  foreach ($tier in $tiers) {
    $need = [int]($want[$tier])
    if ($need -le 0) { continue }
    $pool = @($Catalog | Where-Object { $_.difficulty -eq $tier })
  $fresh = @($pool | Where-Object { $recent -notcontains $_.id } | Sort-Object { Get-Random })
    $stale = @($pool | Where-Object { $recent -contains $_.id } | Sort-Object { Get-Random })
    $ordered = @($fresh) + @($stale)
    $take = [math]::Min($need, $ordered.Count)
    if ($take -gt 0) { $picked += @($ordered | Select-Object -First $take | ForEach-Object { $_.id }) }
  }
  while ($picked.Count -lt $Total) {
    $remaining = @($Catalog | Where-Object { $picked -notcontains $_.id })
    if ($remaining.Count -eq 0) { break }
    $fresh = @($remaining | Where-Object { $recent -notcontains $_.id } | Sort-Object { Get-Random })
    $next = if ($fresh.Count -gt 0) { $fresh[0] } else { ($remaining | Sort-Object { Get-Random } | Select-Object -First 1) }
    $picked += $next.id
  }
  return ($picked -join ",")
}

function Get-PresetProfileKey([hashtable]$Cfg) {
  if ($Cfg.presetKey) { return [string]$Cfg.presetKey }
  if ($Cfg.freezeIds -or $Cfg.handPicked) { return "hand-picked" }
  $size = [int]$Cfg.limit
  if ($Cfg.tierMix) {
    $tm = $Cfg.tierMix
    return ("custom-mix-{0}-e{1}-m{2}-h{3}-x{4}" -f $size, $tm.easy, $tm.medium, $tm.hard, $tm.edge)
  }
  if ($Cfg.difficulty -and -not $Cfg.ids) {
    return ("tier-{0}-{1}" -f $Cfg.difficulty, $size)
  }
  if ($Cfg.cohort -eq "vague" -and $Cfg.difficulty -eq "easy" -and -not $Cfg.ids) {
    return "easy-only-$size"
  }
  if ($Cfg.fullMix) { return "full-mix-$size" }
  if ($Cfg.humanOnly) { return "human-only-$size" }
  return "human-default-$size"
}

function Resolve-BenchmarkPromptSelection {
  param([hashtable]$Cfg)

  $catalog = Get-HumanPromptCatalog
  if ($catalog.Count -eq 0) { return $Cfg }

  $out = @{}
  foreach ($k in $Cfg.Keys) { $out[$k] = $Cfg[$k] }

  if ($out.freezeIds -or $out.presetKey -eq "hand-picked") {
    if ($out.ids) {
      $out.rotationNote = "Fixed prompt list (hand-picked) - same IDs each run"
    }
    return $out
  }

  $presetKey = Get-PresetProfileKey $out
  $out.presetKey = $presetKey
  $size = [int]$out.limit
  if ($size -le 0) { $size = 25 }
  $recent = @(Get-RecentlyUsedPromptIds -PresetKey $presetKey)
  $pool = if ($out.fullMix) { $catalog } else { Get-HumanOnlyCatalog $catalog }

  if ($out.difficulty -and -not $out.ids -and -not $out.tierMix) {
    $pool = @($pool | Where-Object { $_.difficulty -eq $out.difficulty })
    if ($out.cohort) { $pool = @($pool | Where-Object { $_.cohort -eq $out.cohort }) }
    $size = [math]::Min($size, $pool.Count)
    $out.limit = $size
  }

  if ($out.tierMix) {
    $ids = Get-RotatedStratifiedPromptIds -Catalog $pool -Total $size -PresetKey $presetKey -TierWant $out.tierMix
  } elseif ($out.difficulty -and -not $out.ids) {
    $tierWant = @{ easy = 0; medium = 0; hard = 0; edge = 0 }
    if ($tierWant.ContainsKey($out.difficulty)) { $tierWant[$out.difficulty] = $size }
    $ids = Get-RotatedStratifiedPromptIds -Catalog $pool -Total $size -PresetKey $presetKey -TierWant $tierWant
  } else {
    $ids = Get-RotatedStratifiedPromptIds -Catalog $pool -Total $size -PresetKey $presetKey
  }

  $out.ids = $ids
  $idList = @($ids -split "," | Where-Object { $_ })
  $freshCount = @($idList | Where-Object { $recent -notcontains $_ }).Count
  $poolSize = $pool.Count
  $out.rotationNote = ("Fresh rotation: {0}/{1} prompts new vs last {2} run(s) (pool {3})" -f $freshCount, $idList.Count, $script:RotationMaxRuns, $poolSize)
  if (-not $out.variety) { $out.variety = $true }
  return $out
}

function Get-RotationPreviewText([hashtable]$Cfg) {
  if ($Cfg.rotationNote) { return $Cfg.rotationNote }
  if ($Cfg.freezeIds -or $Cfg.presetKey -eq "hand-picked") { return "Fixed IDs - no rotation" }
  return "Prompts rotate each run for this preset"
}
