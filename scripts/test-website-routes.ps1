$base = 'http://127.0.0.1:5000'
$routes = @('/', '/status', '/settings', '/gallery', '/privacy', '/terms', '/api/healthz', '/api/readyz', '/manifest.webmanifest', '/sw.js', '/icons/icon-192.svg', '/icons/icon-512.svg', '/favicon.ico')
Write-Host "LOCAL ROUTES ($base)"
foreach ($r in $routes) {
  try {
    $resp = Invoke-WebRequest -Uri ($base + $r) -UseBasicParsing -TimeoutSec 8
    Write-Host ('  {0,3} {1}' -f $resp.StatusCode, $r)
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'ERR' }
    Write-Host ('  {0,3} {1}' -f $code, $r)
  }
}

Write-Host ""
Write-Host "PUBLIC ROUTES (https://kwalify.net)"
$pub = @('https://kwalify.net/', 'https://kwalify.net/status', 'https://kwalify.net/settings', 'https://kwalify.net/api/readyz', 'https://kwalify.net/api/healthz')
foreach ($u in $pub) {
  try {
    $resp = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 20
    Write-Host ('  {0,3} {1}' -f $resp.StatusCode, $u)
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'ERR' }
    Write-Host ('  {0,3} {1}' -f $code, $u)
  }
}
