# One-shot local dev setup: no passwords. Run PowerShell AS ADMINISTRATOR.
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-dev.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pgData = "C:\Program Files\PostgreSQL\18\data"
$pgHba = Join-Path $pgData "pg_hba.conf"
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$service = "postgresql-x64-18"

if (-not (Test-Path $psql)) {
  throw "PostgreSQL 18 not found. Install from https://www.postgresql.org/download/windows/"
}
if (-not (Test-Path $pgHba)) {
  throw "pg_hba.conf not found at $pgHba"
}

$backup = "$pgHba.bak-kwalify-dev"
if (-not (Test-Path $backup)) {
  Copy-Item $pgHba $backup
}

$lines = Get-Content $pgHba
$out = foreach ($line in $lines) {
  if ($line -match '^\s*#' -or $line -notmatch '^\s*(local|host)\s') {
    $line
  } elseif ($line -match '127\.0\.0\.1|::1/128|^\s*local\s') {
    ($line -replace 'scram-sha-256|md5|password', 'trust')
  } else {
    $line
  }
}
Set-Content -Path $pgHba -Value $out

Restart-Service $service -Force
Start-Sleep -Seconds 2
Write-Host "Local connections now use trust (no password on this PC)."

$sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kwalify') THEN
    CREATE ROLE kwalify LOGIN PASSWORD 'kwalify';
  END IF;
END
`$`$;
SELECT format('CREATE DATABASE %I OWNER %I', 'kwalify', 'kwalify')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kwalify')\gexec
GRANT ALL PRIVILEGES ON DATABASE kwalify TO kwalify;
"@

$sqlFile = Join-Path $env:TEMP "kwalify-setup.sql"
Set-Content -Path $sqlFile -Value $sql -Encoding ASCII
& $psql -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 -f $sqlFile
if ($LASTEXITCODE -ne 0) { throw "Failed to create kwalify database." }

& $psql -U postgres -h localhost -d kwalify -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO kwalify;"
if ($LASTEXITCODE -ne 0) { throw "Failed to grant schema privileges." }

$verify = & $psql -U kwalify -h localhost -d kwalify -t -c "SELECT current_database();"
if ($LASTEXITCODE -ne 0) { throw "kwalify user cannot connect." }

$envPath = Join-Path $root ".env"
$examplePath = Join-Path $root ".env.example"
if (-not (Test-Path $envPath)) {
  Copy-Item $examplePath $envPath
}
$content = Get-Content $envPath -Raw
if ($content -notmatch 'SESSION_SECRET=' -or $content -match 'change-me-to-a-random-string') {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  if ($content -match 'SESSION_SECRET=') {
    $content = $content -replace 'SESSION_SECRET=.*', "SESSION_SECRET=$secret"
  } else {
    $content = "SESSION_SECRET=$secret`n" + $content
  }
}
$content = $content -replace 'DATABASE_URL=.*', 'DATABASE_URL=postgresql://kwalify:kwalify@localhost:5432/kwalify'
Set-Content -Path $envPath -Value $content.TrimEnd()
Add-Content -Path $envPath -Value ""

Write-Host ""
Write-Host "Done. Database: kwalify (no postgres password needed on localhost)."
Write-Host ""
Write-Host "Next (normal PowerShell, no admin):"
Write-Host "  cd $root"
Write-Host "  npm run build"
Write-Host "  npm start"
Write-Host "  http://localhost:5000"
