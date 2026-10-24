@echo off
chcp 65001 >nul
if exist "%LOCALAPPDATA%\MMDB-PG\manager\mmdb-manager.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\MMDB-PG\manager\mmdb-manager.ps1"
) else (
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mmdb-manager.ps1"
)
if errorlevel 1 pause
