$bat = Get-Content -LiteralPath 'C:\Users\Kwalah\Projects\Kwalify\start-kwalify.bat'
$s = [array]::IndexOf($bat, ':SCRIPT')
$e = [array]::IndexOf($bat, ':ENDSCRIPT')
$tmp = Join-Path $env:TEMP 'kwalify-syntax-test.ps1'
$bat[($s + 1)..($e - 1)] | Set-Content -LiteralPath $tmp -Encoding UTF8
$tokens = $null
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($tmp, [ref]$tokens, [ref]$errs)
if ($errs -and $errs.Count -gt 0) {
  $errs | ForEach-Object { Write-Host $_.ToString() }
  exit 1
}
Write-Host 'Syntax OK'
