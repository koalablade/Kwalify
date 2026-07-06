# Generate mkcert TLS certs for https://kwalify.net local dev.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$mkcertCandidates = @(
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\FiloSottile.mkcert_Microsoft.Winget.Source_8wekyb3d8bbwe\mkcert.exe",
  (Get-Command mkcert -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $mkcertCandidates) {
  throw "mkcert not found. Run: winget install FiloSottile.mkcert"
}

& $mkcertCandidates -install
& $mkcertCandidates -cert-file (Join-Path $root "kwalify.net.pem") -key-file (Join-Path $root "kwalify.net-key.pem") kwalify.net

$envPath = Join-Path $root ".env"
if (Test-Path $envPath) {
  $content = Get-Content $envPath -Raw
  $content = $content -replace 'SPOTIFY_REDIRECT_URI=.*', 'SPOTIFY_REDIRECT_URI=https://kwalify.net/api/auth/callback'
  if ($content -notmatch 'APP_URL=') {
    $content += "`nAPP_URL=https://kwalify.net"
  } else {
    $content = $content -replace 'APP_URL=.*', 'APP_URL=https://kwalify.net'
  }
  if ($content -notmatch 'NODE_ENV=') {
    $content += "`nNODE_ENV=development"
  } else {
    $content = $content -replace 'NODE_ENV=.*', 'NODE_ENV=development'
  }
  Set-Content -Path $envPath -Value $content.TrimEnd()
  Add-Content -Path $envPath -Value ""
}

Write-Host ""
Write-Host "Certs ready. Next (Admin PowerShell, one time):"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\add-kwalify-hosts.ps1"
Write-Host ""
Write-Host "Then start:"
Write-Host "  npm run start:local"
