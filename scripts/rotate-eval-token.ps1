# Generate a new PLAYLIST_EVAL_TOKEN and sync to .env + GitHub.
# Paste the printed value into Render, redeploy, then re-run: npm run verify:eval-token
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$bytes = New-Object byte[] 32
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$rng.GetBytes($bytes)
$token = -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })

& (Join-Path $root 'scripts/sync-eval-token.ps1') -Token $token

Write-Host ''
Write-Host '=== ACTION REQUIRED (Render) ==='
Write-Host 'Set PLAYLIST_EVAL_TOKEN to this value, Save, then Manual Deploy:'
Write-Host $token
Write-Host '================================'
