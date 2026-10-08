# Parse-check the launcher scripts (CI: windows runner, pwsh).
$root = Split-Path -Parent $PSScriptRoot
$failed = $false
foreach ($rel in @('scripts\kwalify-local.ps1', 'scripts\turn-off-kwalify-autostart.ps1', 'scripts\ensure-kwalify-ready.ps1')) {
  $script = Join-Path $root $rel
  $tokens = $null
  $errs = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errs)
  if ($errs -and $errs.Count -gt 0) {
    Write-Host "$rel :"
    $errs | ForEach-Object { Write-Host "  $($_.ToString())" }
    $failed = $true
  }
}
if ($failed) { exit 1 }
Write-Host 'Syntax OK'
