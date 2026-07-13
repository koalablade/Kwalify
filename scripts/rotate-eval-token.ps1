# Generate a strong PLAYLIST_EVAL_TOKEN (32 CSPRNG bytes = 64 hex chars) and sync
# to .env + GitHub. Update the value in your host's environment, restart the
# service, then re-run: npm run verify:eval-token
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$bytes = New-Object byte[] 32
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$rng.GetBytes($bytes)
$token = -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })

& (Join-Path $root 'scripts/sync-eval-token.ps1') -Token $token

Write-Host ''
Write-Host '=== ACTION REQUIRED ==='
Write-Host 'Set PLAYLIST_EVAL_TOKEN to this value in the service environment'
Write-Host '(e.g. /etc/kwalify/kwalify.env), then restart the service:'
Write-Host $token
Write-Host '======================='
