# Start Kwalify locally at https://kwalify.net (API on :5000, HTTPS proxy on :443).
# Run scripts\add-kwalify-hosts.ps1 as Admin once first.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$cert = Join-Path $root "kwalify.net.pem"
$key = Join-Path $root "kwalify.net-key.pem"
if (-not (Test-Path $cert)) {
  throw "Missing $cert - run: npm run setup:local-domain"
}

$hosts = Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" -Raw
if ($hosts -notmatch "kwalify\.net") {
  Write-Host "WARNING: kwalify.net not in hosts file."
  Write-Host "Run as Admin: powershell -ExecutionPolicy Bypass -File .\scripts\add-kwalify-hosts.ps1"
}

Write-Host "Starting API on http://127.0.0.1:5000 ..."
$api = Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory $root -PassThru -NoNewWindow

Start-Sleep -Seconds 3

Write-Host "Starting HTTPS proxy https://kwalify.net -> :5000 ..."
Write-Host "Open https://kwalify.net in your browser."
Write-Host "Press Ctrl+C to stop both."

try {
  & "$root\node_modules\.bin\local-ssl-proxy.cmd" --source 443 --target 5000 --cert $cert --key $key
} finally {
  if (-not $api.HasExited) {
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  }
}
