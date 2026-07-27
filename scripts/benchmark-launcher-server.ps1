# Local benchmark launcher UI server (buttons + chat).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [int]$Port = 5055,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Kwalify Launcher - KEEP THIS OPEN"
$Root = (Resolve-Path $Root).Path
Set-Location $Root

. "$PSScriptRoot\benchmark-launcher-api.ps1" -Root $Root

$prefix = "http://127.0.0.1:$Port/"
$publicDir = Join-Path $Root "frontend\public"
$reportsDir = Join-Path $Root "reports"
$pidFile = Join-Path $reportsDir ".benchmark-launcher.pid"

if (-not (Test-Path $reportsDir)) { New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null }

# If already running, restart so you always get the latest launcher code.
if (Test-Path -LiteralPath $pidFile) {
  try {
    $oldPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) {
      Write-Host "  Restarting launcher (fresh session)..." -ForegroundColor Yellow
      Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 600
    }
  } catch {}
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Clear-StaleBenchmarkLock | Out-Null

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

function Send-JsonResponse {
  param($ctx, $obj, [int]$code = 200)
  $json = $obj | ConvertTo-Json -Depth 12 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

function Send-TextResponse {
  param($ctx, [string]$text, [string]$ctype = "text/plain; charset=utf-8", [int]$code = 200)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = $ctype
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

function Send-FileResponse {
  param($ctx, [string]$path, [string]$ctype)
  if (-not (Test-Path -LiteralPath $path)) {
    Send-TextResponse $ctx "Not found" "text/plain" 404
    return
  }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $ctx.Response.StatusCode = 200
  $ctx.Response.ContentType = $ctype
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

function Read-RequestBody($ctx) {
  if (-not $ctx.Request.HasEntityBody) { return "" }
  $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream, $ctx.Request.ContentEncoding)
  return $reader.ReadToEnd()
}

function Get-MimeType([string]$path) {
  switch ([System.IO.Path]::GetExtension($path).ToLower()) {
    ".html" { return "text/html; charset=utf-8" }
    ".css" { return "text/css; charset=utf-8" }
    ".js" { return "application/javascript; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".ico" { return "image/x-icon" }
    ".png" { return "image/png" }
    ".svg" { return "image/svg+xml" }
    default { return "application/octet-stream" }
  }
}

Write-Host ""
Write-Host "  KWALIFY BENCHMARK LAUNCHER" -ForegroundColor Magenta
Write-Host "  $prefix" -ForegroundColor Cyan
Write-Host ""
Write-Host "  KEEP THIS WINDOW OPEN while using the launcher." -ForegroundColor Yellow
Write-Host "  Browser opens automatically. Click buttons or type in chat." -ForegroundColor DarkGray
Write-Host "  Close this window only when you are completely done." -ForegroundColor DarkGray
Write-Host ""

try {
  $listener.Start()
} catch {
  Write-Host "  ERROR: Could not start launcher on port $Port" -ForegroundColor Red
  Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  Close any other Kwalify launcher window and try again." -ForegroundColor Yellow
  pause
  exit 1
}

Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII

if (-not $NoBrowser) { Start-Process $prefix | Out-Null }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath
    $method = $ctx.Request.HttpMethod.ToUpper()

    try {
      if ($method -eq "OPTIONS") {
        $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
        $ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        $ctx.Response.StatusCode = 204
        $ctx.Response.Close()
        continue
      }

      if ($path -eq "/" -or $path -eq "/launcher" -or $path -eq "/benchmark-launcher.html") {
        Send-FileResponse $ctx (Join-Path $publicDir "benchmark-launcher.html") "text/html; charset=utf-8"
        continue
      }

      if ($path -eq "/api/ping") {
        Send-JsonResponse $ctx (Get-LauncherPing)
        continue
      }

      if ($path -eq "/api/state") {
        Send-JsonResponse $ctx (Get-LauncherState)
        continue
      }

      if ($path -eq "/api/buttons") {
        Send-JsonResponse $ctx @{ buttons = @(Get-LauncherButtonPresets) }
        continue
      }

      if ($path -eq "/api/clear-lock" -and $method -eq "POST") {
        $cleared = Clear-StaleBenchmarkLock
        Send-JsonResponse $ctx @{ ok = $true; cleared = $cleared; running = (Test-BenchmarkRunning) }
        continue
      }

      if ($path -eq "/api/run" -and $method -eq "POST") {
        $body = Read-RequestBody $ctx | ConvertFrom-Json
        $result = if ($body.suite -eq "repeat") {
          Invoke-LauncherRun -Suite "repeat"
        } elseif ($body.suite) {
          Invoke-LauncherRun -Suite ([string]$body.suite)
        } else {
          Invoke-LauncherRun -Request ([string]$body.request)
        }
        Send-JsonResponse $ctx $result $(if ($result.ok) { 200 } else { 409 })
        continue
      }

      if ($path -eq "/api/chat" -and $method -eq "POST") {
        $body = Read-RequestBody $ctx | ConvertFrom-Json
        $force = $false
        if ($body.PSObject.Properties.Name -contains "forceRun") { $force = [bool]$body.forceRun }
        Send-JsonResponse $ctx (Invoke-LauncherChat -Message ([string]$body.message) -ForceRun:$force)
        continue
      }

      if ($path -eq "/api/open-reports") {
        if (Test-Path $reportsDir) { Start-Process explorer.exe $reportsDir | Out-Null }
        Send-JsonResponse $ctx @{ ok = $true }
        continue
      }

      if ($path.StartsWith("/reports/")) {
        $rel = $path.Substring("/reports/".Length) -replace '/', '\'
        $file = Join-Path $reportsDir $rel
        $full = [System.IO.Path]::GetFullPath($file)
        if (-not $full.StartsWith($reportsDir, [StringComparison]::OrdinalIgnoreCase)) {
          Send-TextResponse $ctx "Forbidden" "text/plain" 403
          continue
        }
        Send-FileResponse $ctx $full (Get-MimeType $full)
        continue
      }

      if ($path.StartsWith("/public/")) {
        $rel = $path.Substring("/public/".Length) -replace '/', '\'
        $file = Join-Path $publicDir $rel
        Send-FileResponse $ctx $file (Get-MimeType $file)
        continue
      }

      Send-TextResponse $ctx "Not found" "text/plain" 404
    } catch {
      try {
        Send-JsonResponse $ctx @{ ok = $false; error = $_.Exception.Message } 500
      } catch {}
    }
  }
} finally {
  if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
  $listener.Stop()
}
