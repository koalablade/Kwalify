# Adds kwalify.net -> 127.0.0.1. Run PowerShell AS ADMINISTRATOR (one time).
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$marker = "kwalify.net"
$content = Get-Content $hostsPath -ErrorAction Stop
if ($content -match $marker) {
  Write-Host "hosts already contains kwalify.net"
  Select-String -Path $hostsPath -Pattern $marker
  exit 0
}
Add-Content -Path $hostsPath -Value "`n127.0.0.1 kwalify.net"
Write-Host "Added: 127.0.0.1 kwalify.net"
Select-String -Path $hostsPath -Pattern $marker
