# Shared benchmark web URL helper (prefers local API when up, else kwalify.net).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$localApi = "http://127.0.0.1:5000"

function Get-BenchmarkWebUrl {
  foreach ($candidate in @(
    @{ Base = $localApi; Url = "$localApi/benchmark" },
    @{ Base = "https://kwalify.net"; Url = "https://kwalify.net/benchmark" }
  )) {
    try {
      $ping = Invoke-RestMethod -Uri "$($candidate.Base)/api/benchmark/ping" -TimeoutSec 4
      if ($ping.ok) { return $candidate.Url }
    } catch {}
  }
  return "$localApi/benchmark"
}

function Get-BenchmarkStatusUrl {
  return (Get-BenchmarkWebUrl) + "#live-dashboard"
}
