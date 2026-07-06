# Create local Kwalify PostgreSQL user + database (native install, no Docker).
# Usage (pick one):
#   $env:PGPASSWORD = "<postgres superuser password>"; .\scripts\setup-local-postgres.ps1
#   .\scripts\setup-local-postgres.ps1 -PostgresPassword "<password>"

param(
  [string]$PostgresPassword
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$psqlCandidates = @(
  "C:\Program Files\PostgreSQL\18\bin\psql.exe",
  "C:\Program Files\PostgreSQL\17\bin\psql.exe",
  "C:\Program Files\PostgreSQL\16\bin\psql.exe"
)
$psql = $psqlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $psql) {
  throw "psql not found. Install PostgreSQL from https://www.postgresql.org/download/windows/"
}
if ($PostgresPassword) {
  $env:PGPASSWORD = $PostgresPassword
}
if (-not $env:PGPASSWORD) {
  $secure = Read-Host "PostgreSQL superuser (postgres) password" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}
if (-not $env:PGPASSWORD) {
  throw "PostgreSQL password required."
}

Write-Host "Using $psql"

function Invoke-Psql {
  param([string[]]$Args)
  & $psql @Args
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed (exit $LASTEXITCODE). Wrong postgres password? See scripts/reset-postgres-password.ps1"
  }
}

Invoke-Psql -Args @("-U", "postgres", "-h", "localhost", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", (Join-Path $PSScriptRoot "setup-local-postgres.sql"))
Invoke-Psql -Args @("-U", "postgres", "-h", "localhost", "-d", "kwalify", "-v", "ON_ERROR_STOP=1", "-c", "GRANT ALL ON SCHEMA public TO kwalify; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO kwalify; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO kwalify;")

$env:PGPASSWORD = "kwalify"
$verify = & $psql -U kwalify -h localhost -d kwalify -c "SELECT current_database();" 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Setup incomplete: kwalify user cannot connect. $verify"
}

$secretBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
$sessionSecret = [Convert]::ToBase64String($secretBytes)

$envPath = Join-Path $root ".env"
$examplePath = Join-Path $root ".env.example"
if (-not (Test-Path $envPath)) {
  Copy-Item $examplePath $envPath
}
$content = Get-Content $envPath -Raw
$content = $content -replace 'change-me-to-a-random-string-at-least-32-characters', $sessionSecret
if ($content -notmatch 'DATABASE_URL=') {
  $content = "DATABASE_URL=postgresql://kwalify:kwalify@localhost:5432/kwalify`n" + $content
} else {
  $content = $content -replace 'DATABASE_URL=.*', 'DATABASE_URL=postgresql://kwalify:kwalify@localhost:5432/kwalify'
}
Set-Content -Path $envPath -Value $content.TrimEnd() -NoNewline
Add-Content -Path $envPath -Value ""

Write-Host ""
Write-Host "Database ready: postgresql://kwalify:kwalify@localhost:5432/kwalify"
Write-Host "Wrote $envPath (SESSION_SECRET generated)."
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Add SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET to .env"
Write-Host "  2. npm run build"
Write-Host "  3. npm start"
Write-Host "  4. Open http://localhost:5000"
