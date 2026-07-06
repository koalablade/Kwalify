# Reset the local PostgreSQL superuser (postgres) password on Windows.
# Run PowerShell AS ADMINISTRATOR.
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\reset-postgres-password.ps1 -NewPassword "your-new-password"

param(
  [Parameter(Mandatory = $true)]
  [string]$NewPassword
)

$ErrorActionPreference = "Stop"
$pgData = "C:\Program Files\PostgreSQL\18\data"
$pgHba = Join-Path $pgData "pg_hba.conf"
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$service = "postgresql-x64-18"

if (-not (Test-Path $pgHba)) {
  throw "pg_hba.conf not found at $pgHba - adjust PostgreSQL version path if needed."
}

$backup = "$pgHba.bak-kwalify"
if (-not (Test-Path $backup)) {
  Copy-Item $pgHba $backup
  Write-Host "Backed up pg_hba.conf to $backup"
}

$content = Get-Content $pgHba -Raw
$trust = $content -replace 'scram-sha-256', 'trust'
if ($trust -eq $content) {
  Write-Host "pg_hba.conf already uses trust (or unexpected format)."
} else {
  Set-Content -Path $pgHba -Value $trust -NoNewline
  Write-Host "Temporarily enabled trust auth for local connections."
}

Restart-Service $service -Force
Start-Sleep -Seconds 2

$escaped = $NewPassword -replace "'", "''"
$sql = "ALTER USER postgres WITH PASSWORD '$escaped';"
& $psql -U postgres -h localhost -d postgres -c $sql
if ($LASTEXITCODE -ne 0) { throw "Failed to set postgres password." }

Set-Content -Path $pgHba -Value (Get-Content $backup -Raw) -NoNewline
Write-Host "Restored pg_hba.conf (password auth re-enabled)."
Restart-Service $service -Force

Write-Host ""
Write-Host "postgres password updated. Now run:"
Write-Host "  cd C:\Users\Kwalah\Projects\Kwalify"
Write-Host ('  powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-postgres.ps1 -PostgresPassword "' + $NewPassword + '"')
