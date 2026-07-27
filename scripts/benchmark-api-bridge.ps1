# Node /api/benchmark bridge — full launcher API (state, run, chat) as JSON on stdout.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("run", "chat", "clear-lock")]
  [string]$Action,
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Suite = "",
  [string]$Request = "",
  [string]$Message = "",
  [switch]$ForceRun,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

. "$PSScriptRoot\benchmark-launcher-api.ps1" -Root $Root

function Get-LastSpawnStatus {
  $path = Join-Path $Root "reports\benchmark-last-spawn.json"
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { return $null }
}

function ConvertTo-PlainData($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [string] -or $Value -is [ValueType]) { return $Value }
  if ($Value -is [System.Collections.IDictionary]) {
    $out = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $out[[string]$key] = ConvertTo-PlainData $Value[$key]
    }
    return $out
  }
  if ($Value -is [System.Array]) {
    return @($Value | ForEach-Object { ConvertTo-PlainData $_ })
  }
  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
    return @($Value | ForEach-Object { ConvertTo-PlainData $_ })
  }
  if ($Value.PSObject -and $Value.PSObject.Properties) {
    $out = [ordered]@{}
    foreach ($prop in $Value.PSObject.Properties) {
      $out[$prop.Name] = ConvertTo-PlainData $prop.Value
    }
    return $out
  }
  return [string]$Value
}

function Invoke-ClearBenchmarkLock {
  $stop = Join-Path $Root "scripts\stop-benchmark.ps1"
  if (Test-Path -LiteralPath $stop) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stop -Root $Root -RunOnly | Out-Null
  }
  $cleared = $false
  if (Test-Path -LiteralPath $script:LauncherLock) {
    try {
      Remove-Item -LiteralPath $script:LauncherLock -Force -ErrorAction Stop
      $cleared = $true
    } catch {}
  }
  if (-not $cleared) {
    $cleared = [bool](Clear-StaleBenchmarkLock)
  }
  return @{
    ok = $true
    cleared = $cleared
    running = Test-BenchmarkRunning
  }
}

$result = switch ($Action) {
  "run" {
    if ($Suite -eq "repeat") {
      Invoke-LauncherRun -Suite "repeat" -DryRun:$DryRun
    } elseif ($Suite) {
      Invoke-LauncherRun -Suite $Suite -DryRun:$DryRun
    } elseif ($Request) {
      Invoke-LauncherRun -Request $Request -DryRun:$DryRun
    } else {
      @{ ok = $false; error = "No suite or request specified." }
    }
  }
  "chat" {
    Invoke-LauncherChat -Message $Message -ForceRun:$ForceRun
  }
  "clear-lock" {
    Invoke-ClearBenchmarkLock
  }
}

if ($Action -eq "run" -and $result.ok -and -not $DryRun) {
  $spawn = Get-LastSpawnStatus
  if ($spawn -and $spawn.pid) {
    $result.pid = $spawn.pid
  }
}

ConvertTo-PlainData $result | ConvertTo-Json -Depth 12 -Compress
