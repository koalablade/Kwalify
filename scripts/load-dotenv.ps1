# Load repo-root .env into the current PowerShell process (.env wins over stale shell vars).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [switch]$Optional
)

$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) {
  if ($Optional) {
    Write-Host "  .env not found — skipping (copy .env.example to configure)"
    return
  }
  throw ".env not found at $envFile - copy .env.example and configure it first."
}

foreach ($line in Get-Content $envFile) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
  if ($trimmed -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
  $key = $Matches[1]
  $value = $Matches[2].Trim()
  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  Set-Item -Path "env:$key" -Value $value
}
