# Restart API in self-host production mode (no tunnel). Used for fixes / recovery.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
Set-Location $Root

. (Join-Path $Root "scripts\kwalify-health-lib.ps1") -Root $Root

if (-not (Assert-KwalifySafeToRestart -Reason "API restart")) {
  exit 2
}

function Load-DotEnv([string]$path) {
  foreach ($line in Get-Content -LiteralPath $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    if ($t -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $v = $Matches[2].Trim().Trim('"').Trim("'")
    Set-Item -Path "env:$($Matches[1])" -Value $v
  }
}

$port = 5000
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Load-DotEnv (Join-Path $Root ".env")
$env:NODE_ENV = "production"
$prevErr = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$env:GIT_COMMIT = (git -C $Root rev-parse HEAD 2>$null)
$ErrorActionPreference = $prevErr
if (-not $env:GIT_COMMIT) { $env:GIT_COMMIT = "local-dev" }

$apiPs1 = Join-Path $env:TEMP "kwalify-api-restart.ps1"
# $using: only works inside Invoke-Command — embed $Root when writing the helper script.
@"
Set-Location '$Root'
foreach (`$line in Get-Content '.env') {
  `$t = `$line.Trim()
  if (-not `$t -or `$t.StartsWith('#')) { continue }
  if (`$t -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    `$v = `$Matches[2].Trim().Trim('"').Trim("'")
    Set-Item "env:`$(`$Matches[1])" `$v
  }
}
`$env:NODE_ENV = 'production'
`$env:GIT_COMMIT = (git rev-parse HEAD 2>`$null)
if (-not `$env:GIT_COMMIT) { `$env:GIT_COMMIT = 'local-dev' }
npm start
"@ | Set-Content -LiteralPath $apiPs1 -Encoding UTF8

Start-Process powershell -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $apiPs1) `
  -WorkingDirectory $Root -WindowStyle Minimized | Out-Null

$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
  try {
    if (Test-KwalifyLive -TimeoutSec 3) { break }
  } catch {}
  Start-Sleep -Seconds 2
}

foreach ($route in @("/status", "/settings", "/api/livez")) {
  try {
    $code = (Invoke-WebRequest "http://localhost:5000$route" -UseBasicParsing -TimeoutSec 5).StatusCode
    Write-Host "  $route -> HTTP $code"
  } catch {
    Write-Host "  $route -> failed"
  }
}
