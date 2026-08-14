# Quick health + eval-token check for local API (default http://localhost:5000).
param(
  [string]$BaseUrl = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\load-dotenv.ps1"

if (-not $env:SMOKE_SPOTIFY_USER_ID) {
  $env:SMOKE_SPOTIFY_USER_ID = "koalablade"
}

$token = $env:PLAYLIST_EVAL_TOKEN
if (-not $token) {
  throw "PLAYLIST_EVAL_TOKEN missing in .env - run: npm run sync:eval-token -Token `"<21-char eval token>`""
}
if ($token.Length -ne 21) {
  throw "PLAYLIST_EVAL_TOKEN must be 21 characters (got $($token.Length))."
}

Write-Host "Preflight -> $BaseUrl"
Write-Host "  Spotify user: $(if ($env:SMOKE_SPOTIFY_USER_ID) { $env:SMOKE_SPOTIFY_USER_ID } else { '(missing - add SMOKE_SPOTIFY_USER_ID=koalablade to .env)' })"

try {
  $health = Invoke-RestMethod -Uri "$BaseUrl/api/healthz" -TimeoutSec 8
  Write-Host "  healthz: ok"
} catch {
  throw "API not reachable at $BaseUrl - start the server first (double-click start.bat or Desktop Start Kwalify)."
}

try {
  $ping = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/eval/ping" `
    -Headers @{ "x-kwalify-evaluation-token" = $token } -TimeoutSec 15
  if ($ping.tokenAccepted -ne $true) {
    throw "Eval token rejected - restart the server after updating .env (token length $($token.Length))."
  }
  Write-Host "  eval ping: token accepted (commit $($ping.commit))"
} catch {
  if ($_.Exception.Message -match "Eval token rejected") { throw }
  throw "Eval ping failed: $($_.Exception.Message)"
}

Write-Host "Preflight passed."
