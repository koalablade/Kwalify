# Safe cleanup + archive last week's agent context. Run with -WhatIf to preview.
param([switch]$WhatIf)

$ErrorActionPreference = "Stop"
$Root = "C:\Users\Kwalah\Projects\Kwalify"
$Archive = Join-Path $Root "docs\archive\cursor-context-week"
$Cutoff = (Get-Date).AddDays(-7)
$KeepProject = "c-Users-Kwalah-Projects-Kwalify"

function Remove-Safe([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host "  skip (missing): $Label" -ForegroundColor DarkGray
    return 0
  }
  $mb = [math]::Round((Get-ChildItem -LiteralPath $Path -Recurse -File -Force -EA SilentlyContinue |
    Measure-Object Length -Sum).Sum / 1MB, 1)
  if ($WhatIf) {
    Write-Host "  WOULD DELETE ($mb MB): $Label" -ForegroundColor Yellow
    return $mb
  }
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
  Write-Host "  deleted ($mb MB): $Label" -ForegroundColor Green
  return $mb
}

function Remove-SafeFile([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host "  skip (missing): $Label" -ForegroundColor DarkGray
    return 0
  }
  $mb = [math]::Round((Get-Item -LiteralPath $Path).Length / 1MB, 1)
  if ($WhatIf) {
    Write-Host "  WOULD DELETE ($mb MB): $Label" -ForegroundColor Yellow
    return $mb
  }
  Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
  Write-Host "  deleted ($mb MB): $Label" -ForegroundColor Green
  return $mb
}

Write-Host "`n=== ARCHIVE LAST WEEK AGENT CONTEXT ===" -ForegroundColor Cyan
$transcripts = "C:\Users\Kwalah\.cursor\projects\$KeepProject\agent-transcripts"
if (-not $WhatIf) {
  New-Item -ItemType Directory -Force -Path $Archive | Out-Null
}
if (Test-Path $transcripts) {
  $recent = Get-ChildItem -LiteralPath $transcripts -Recurse -File -Filter "*.jsonl" -Force |
    Where-Object { $_.LastWriteTime -ge $Cutoff }
  Write-Host "  Archiving $($recent.Count) transcript files from last 7 days"
  foreach ($f in $recent) {
    $rel = $f.FullName.Substring($transcripts.Length).TrimStart('\')
    $dest = Join-Path $Archive $rel
    if (-not $WhatIf) {
      $destDir = Split-Path $dest -Parent
      if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
      Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
    }
  }
  # Also copy recent benchmark state
  foreach ($rel in @("reports\benchmark-history.json", "reports\benchmark-live.json", "reports\benchmark-last-choice.json")) {
    $src = Join-Path $Root $rel
    if (Test-Path $src) {
      $dest = Join-Path $Archive $rel
      if (-not $WhatIf) {
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
        Copy-Item -LiteralPath $src -Destination $dest -Force
      }
      Write-Host "  archived $rel"
    }
  }
}

Write-Host "`n=== KWALIFY SAFE DELETES ===" -ForegroundColor Cyan
$freed = 0
$freed += Remove-Safe (Join-Path $Root "reports\playlist-evaluation") "old playlist-evaluation runs"
$freed += Remove-Safe (Join-Path $Root "results-real") "results-real experiment outputs"
$freed += Remove-SafeFile (Join-Path $Root "kwalify-benchmark.log.old") "rotated benchmark log"
$freed += Remove-SafeFile (Join-Path $Root "server-boot.log") "server boot log"
$freed += Remove-SafeFile (Join-Path $Root "backend\tests\benchmark-15min-soak-output.log") "soak test log"
Get-ChildItem (Join-Path $Root "backend\scripts") -Filter "_tmp-*.mjs" -File -EA SilentlyContinue | ForEach-Object {
  $freed += Remove-SafeFile $_.FullName "tmp script $($_.Name)"
}

Write-Host "`n=== CURSOR SAFE DELETES ===" -ForegroundColor Cyan
$freed += Remove-Safe "C:\Users\Kwalah\AppData\Roaming\Cursor\logs" "Cursor logs"
$freed += Remove-Safe "C:\Users\Kwalah\AppData\Roaming\Cursor\CachedData" "Cursor CachedData"

# Old agent CLI versions - keep newest only
$verDir = "C:\Users\Kwalah\AppData\Roaming\Cursor\User\globalStorage\anysphere.cursor-agent-worker\agent-cli\.local\share\cursor-agent\versions"
if (Test-Path $verDir) {
  $versions = Get-ChildItem $verDir -Directory | Sort-Object Name -Descending
  foreach ($old in $versions | Select-Object -Skip 1) {
    $freed += Remove-Safe $old.FullName "old agent version $($old.Name)"
  }
}

# Old .cursor project copies (not current Kwalify)
$projRoot = "C:\Users\Kwalah\.cursor\projects"
if (Test-Path $projRoot) {
  Get-ChildItem $projRoot -Directory | Where-Object { $_.Name -ne $KeepProject } | ForEach-Object {
    $freed += Remove-Safe $_.FullName "old cursor project $($_.Name)"
  }
}

# Delete agent transcripts older than 7 days (keep recent in .cursor + archive copy)
if (Test-Path $transcripts) {
  $old = Get-ChildItem -LiteralPath $transcripts -Recurse -File -Filter "*.jsonl" -Force |
    Where-Object { $_.LastWriteTime -lt $Cutoff }
  foreach ($f in $old) {
    $mb = [math]::Round($f.Length / 1MB, 1)
    if ($WhatIf) {
      Write-Host "  WOULD DELETE old transcript ($mb MB): $($f.Name)" -ForegroundColor Yellow
    } else {
      Remove-Item -LiteralPath $f.FullName -Force
      Write-Host "  deleted old transcript ($mb MB): $($f.Name)" -ForegroundColor Green
    }
    $freed += $mb
  }
}

Write-Host "`n=== DONE ===" -ForegroundColor Magenta
Write-Host ("Estimated freed: ~{0:N1} MB" -f $freed)
if (-not $WhatIf) {
  Write-Host "Archive saved to: $Archive"
  Write-Host ""
  Write-Host "NOTE: state.vscdb (28 GB) was NOT deleted - Cursor must be fully closed to compact it."
  Write-Host "      Your last-week transcripts are archived in docs/archive/cursor-context-week/"
}
