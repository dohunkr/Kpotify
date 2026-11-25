param(
    [string]$SpotifyDir = "$env:APPDATA\Spotify",
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Kpotify - 제거(Uninstall)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$xpuiPath = Join-Path $SpotifyDir "Apps\xpui.spa"
$spotifyExe = Join-Path $SpotifyDir "Spotify.exe"

if (-not (Test-Path $xpuiPath)) {
    Write-Host "[오류] xpui.spa 파일을 찾을 수 없습니다: $xpuiPath" -ForegroundColor Red
    exit 1
}

$running = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "[1/3] 실행 중인 Spotify를 종료하는 중..." -ForegroundColor Yellow
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
} else {
    Write-Host "[1/3] Spotify 실행 상태 확인 완료." -ForegroundColor Green
}

Write-Host "[2/3] xpui.spa에서 Kpotify 확장을 제거하는 중..." -ForegroundColor Yellow
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($xpuiPath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $existingJs = $zip.GetEntry("kpotify/kpotify.js")
    if ($existingJs) {
        $existingJs.Delete()
    }

    $indexEntry = $zip.GetEntry("index.html")
    if ($indexEntry) {
        $reader = New-Object System.IO.StreamReader($indexEntry.Open(), [System.Text.Encoding]::UTF8)
        try {
            $html = $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }

        $html = [regex]::Replace($html, '<script[^>]*src="/kpotify/kpotify\.js"[^>]*></script>', '')

        $indexEntry.Delete()
        $newIndexEntry = $zip.CreateEntry("index.html", [System.IO.Compression.CompressionLevel]::Optimal)
        $htmlBytes = [System.Text.Encoding]::UTF8.GetBytes($html)
        $indexStream = $newIndexEntry.Open()
        try {
            $indexStream.Write($htmlBytes, 0, $htmlBytes.Length)
        } finally {
            $indexStream.Dispose()
        }
    }
} finally {
    $zip.Dispose()
}

if (-not $NoLaunch -and (Test-Path $spotifyExe)) {
    Write-Host "[3/3] Spotify를 다시 실행하는 중..." -ForegroundColor Green
    Start-Process -FilePath $spotifyExe
} else {
    Write-Host "[3/3] 제거 완료!" -ForegroundColor Green
}

Write-Host ""
Write-Host "Kpotify가 정상적으로 제거되었습니다." -ForegroundColor Cyan
