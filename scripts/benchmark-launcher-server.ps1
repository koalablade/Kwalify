# Legacy port 5055 - redirects to benchmark on the main Kwalify site.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [int]$Port = 5055,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
Set-Location $Root
. (Join-Path $Root "scripts\load-dotenv.ps1") -Root $Root

$appUrl = $env:APP_URL
if ($appUrl) { $appUrl = $appUrl.Trim().TrimEnd("/") } else { $appUrl = "https://kwalify.net" }
. (Join-Path $Root "scripts\benchmark-url.ps1") -Root $Root
$benchmarkUrl = Get-BenchmarkWebUrl
$localBenchmark = "http://127.0.0.1:5000/benchmark"
$publicBenchmark = $benchmarkUrl

function Get-RedirectTarget {
  return $benchmarkUrl
}

Write-Host ""
Write-Host "  Benchmark on the main site:" -ForegroundColor Yellow
Write-Host "  $benchmarkUrl" -ForegroundColor Green
Write-Host ""

if (-not $NoBrowser) {
  Start-Process $benchmarkUrl | Out-Null
}

$prefix = "http://127.0.0.1:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Host "  (Port $Port in use - open $benchmarkUrl directly)" -ForegroundColor DarkYellow
  exit 0
}

Write-Host "  Redirecting port $Port -> $benchmarkUrl" -ForegroundColor DarkGray
Write-Host "  Close this window to stop the redirect." -ForegroundColor DarkGray
Write-Host ""

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $target = Get-RedirectTarget
      $ctx.Response.StatusCode = 302
      $ctx.Response.Headers.Add("Location", $target)
      $ctx.Response.ContentType = "text/html; charset=utf-8"
      $body = @"
<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=$target" /></head>
<body><p>Redirecting to <a href="$target">$target</a></p></body></html>
"@
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
    } catch {
      try { $ctx.Response.Close() } catch {}
    }
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
