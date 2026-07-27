$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'scripts\start-kwalify-core.ps1'
$tokens = $null
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errs)
if ($errs -and $errs.Count -gt 0) {
  $errs | ForEach-Object { Write-Host $_.ToString() }
  exit 1
}
Write-Host 'Syntax OK'
