# Open Windows Firewall for self-hosted Kwalify (run as Administrator).
$ErrorActionPreference = "Stop"

function Ensure-Rule([string]$Name, [int]$Port) {
  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "  Firewall rule exists: $Name (port $Port)"
    return
  }
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
  Write-Host "  Opened port $Port - $Name" -ForegroundColor Green
}

Write-Host "Opening firewall for Kwalify..." -ForegroundColor Cyan
Ensure-Rule "Kwalify API" 5000
Ensure-Rule "Kwalify HTTPS" 443
Write-Host "Done."
