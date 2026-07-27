# Shared benchmark web URL helper (prefers kwalify.net when reachable).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$localApi = "http://127.0.0.1:5000"

function Get-BenchmarkWebUrl {
  foreach ($candidate in @(
    @{ Base = "https://kwalify.net"; Url = "https://kwalify.net/benchmark" },
    @{ Base = $localApi; Url = "$localApi/benchmark" }
  )) {
    try {
      $ping = Invoke-RestMethod -Uri "$($candidate.Base)/api/benchmark/ping" -TimeoutSec 4
      if ($ping.ok) { return $candidate.Url }
    } catch {}
  }
  return "https://kwalify.net/benchmark"
}

function Get-BenchmarkStatusUrl {
  $base = (Get-BenchmarkWebUrl) -replace '/benchmark$', ''
  return "$base/benchmark#live-dashboard"
}
