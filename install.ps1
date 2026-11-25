param(
    [string]$SpotifyDir = "$env:APPDATA\Spotify",
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Kpotify - Spotify 한국어 가사 번역 설치기" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$xpuiPath = Join-Path $SpotifyDir "Apps\xpui.spa"
$backupPath = Join-Path $SpotifyDir "Apps\xpui.spa.kpotify.bak"
$spotifyExe = Join-Path $SpotifyDir "Spotify.exe"
$scriptSource = Join-Path $PSScriptRoot "extension\kpotify.js"

if (-not (Test-Path $xpuiPath)) {
    Write-Host "[오류] Spotify xpui.spa 파일을 찾을 수 없습니다: $xpuiPath" -ForegroundColor Red
    Write-Host "Spotify 데스크탑 앱이 설치되어 있는지 확인해주세요." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $scriptSource)) {
    Write-Host "[오류] 확장 스크립트를 찾을 수 없습니다: $scriptSource" -ForegroundColor Red
    exit 1
}

# 1. Close Spotify if running
$running = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "[1/4] 실행 중인 Spotify를 종료하는 중..." -ForegroundColor Yellow
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
} else {
    Write-Host "[1/4] Spotify 실행 상태 확인 완료." -ForegroundColor Green
}

# 2. Backup xpui.spa if no clean backup exists
if (-not (Test-Path $backupPath)) {
    Write-Host "[2/4] 원본 xpui.spa 백업 생성 중..." -ForegroundColor Yellow
    Copy-Item -Path $xpuiPath -Destination $backupPath -Force
} else {
    Write-Host "[2/4] 기존 백업 파일 유지: $backupPath" -ForegroundColor Green
}

# 3. Patch xpui.spa using .NET ZipFile
Write-Host "[3/4] xpui.spa에 Kpotify 확장 삽입 중..." -ForegroundColor Yellow
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($xpuiPath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    # Remove existing kpotify/kpotify.js if present
    $existingJs = $zip.GetEntry("kpotify/kpotify.js")
    if ($existingJs) {
        $existingJs.Delete()
    }

    # Add kpotify/kpotify.js
    $newJsEntry = $zip.CreateEntry("kpotify/kpotify.js", [System.IO.Compression.CompressionLevel]::Optimal)
    $jsBytes = [System.IO.File]::ReadAllBytes($scriptSource)
    $jsStream = $newJsEntry.Open()
    try {
        $jsStream.Write($jsBytes, 0, $jsBytes.Length)
    } finally {
        $jsStream.Dispose()
    }

    # Patch index.html
    $indexEntry = $zip.GetEntry("index.html")
    if (-not $indexEntry) {
        throw "xpui.spa 내부에서 index.html을 찾을 수 없습니다."
    }

    $reader = New-Object System.IO.StreamReader($indexEntry.Open(), [System.Text.Encoding]::UTF8)
    try {
        $html = $reader.ReadToEnd()
    } finally {
        $reader.Dispose()
    }

    # Remove any previous kpotify script tag (idempotent)
    $html = [regex]::Replace($html, '<script[^>]*src="/kpotify/kpotify\.js"[^>]*></script>', '')

    $scriptTag = '<script defer="defer" src="/kpotify/kpotify.js"></script>'
    if ($html -match '</body>') {
        $html = $html -replace '</body>', "$scriptTag</body>"
    } else {
        $html += $scriptTag
    }

    $indexEntry.Delete()
    $newIndexEntry = $zip.CreateEntry("index.html", [System.IO.Compression.CompressionLevel]::Optimal)
    $htmlBytes = [System.Text.Encoding]::UTF8.GetBytes($html)
    $indexStream = $newIndexEntry.Open()
    try {
        $indexStream.Write($htmlBytes, 0, $htmlBytes.Length)
    } finally {
        $indexStream.Dispose()
    }
} finally {
    $zip.Dispose()
}

# Clear CEF browser cache so Spotify reloads updated index.html & kpotify.js
$cacheDirs = @(
    (Join-Path $env:LOCALAPPDATA "Spotify\Browser\Cache"),
    (Join-Path $env:LOCALAPPDATA "Spotify\Browser\Code Cache")
)
foreach ($dir in $cacheDirs) {
    if (Test-Path $dir) {
        Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 4. Restart Spotify
if (-not $NoLaunch -and (Test-Path $spotifyExe)) {
    Write-Host "[4/4] Spotify를 다시 실행하는 중..." -ForegroundColor Green
    Start-Process -FilePath $spotifyExe
} else {
    Write-Host "[4/4] 설치 완료! Spotify를 실행해주세요." -ForegroundColor Green
}

Write-Host ""
Write-Host "Kpotify 설치가 완료되었습니다!" -ForegroundColor Cyan
Write-Host "가사 화면 우측 하단의 '가사 번역' 버튼으로 모드를 바꿀 수 있습니다." -ForegroundColor Gray
