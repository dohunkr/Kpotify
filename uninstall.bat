@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
if %errorlevel% neq 0 (
    echo.
    echo 제거 중 오류가 발생했습니다.
    pause
) else (
    timeout /t 3 >nul
)
