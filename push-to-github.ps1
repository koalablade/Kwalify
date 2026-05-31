# Publish Kwalify to GitHub (fixes Replit gitsafe errors).
# Right-click -> Run with PowerShell

$ErrorActionPreference = "Stop"
$Gh = "C:\Program Files\GitHub CLI\gh.exe"
$Git = "C:\Program Files\Git\cmd\git.exe"
$RepoRoot = $PSScriptRoot

Set-Location $RepoRoot
Write-Host "Project: $RepoRoot" -ForegroundColor Cyan

# --- Remove Replit gitsafe (causes "port 5418" push errors) ---
Write-Host "`nRemoving Replit gitsafe / LFS settings...`n" -ForegroundColor Yellow
& $Git remote remove gitsafe-backup 2>$null
& $Git config --local --remove-section "lfs.http://gitsafe:5419" 2>$null
& $Git config --local --unset-all "lfs.url" 2>$null
& $Git lfs uninstall 2>$null
& $Git config --local --unset-all filter.lfs.process 2>$null
& $Git config --local --unset-all filter.lfs.smudge 2>$null
& $Git config --local --unset-all filter.lfs.clean 2>$null
$env:GIT_LFS_SKIP_PUSH = "1"

if (-not (Test-Path $Gh)) {
    Write-Host "GitHub CLI not found. Use GitHub Desktop -> Publish repository instead."
    exit 1
}

Write-Host "`n[1/2] Log in to GitHub (choose: GitHub.com, HTTPS, Login with browser)`n" -ForegroundColor Yellow
& $Gh auth login

$user = (& $Gh api user -q .login 2>$null)
if (-not $user) {
    Write-Host "Login failed. Run again after signing in."
    exit 1
}

$url = "https://github.com/$user/kwalify.git"
Write-Host "`nAccount: $user" -ForegroundColor Green
& $Git remote remove origin 2>$null
& $Git remote add origin $url

Write-Host "`n[2/2] Push to GitHub (LFS skip enabled)...`n" -ForegroundColor Yellow
$created = & $Gh repo create kwalify --public --source=. --remote=origin 2>&1
Write-Host $created
& $Git push -u origin main 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nSuccess: https://github.com/$user/kwalify" -ForegroundColor Green
} else {
    Write-Host "`nPush failed. Copy the error above and ask for help." -ForegroundColor Red
}

Write-Host "`nPress Enter to close..."
Read-Host
