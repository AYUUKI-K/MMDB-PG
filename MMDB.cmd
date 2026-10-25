@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0scripts\portable.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\portable.ps1"
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mmdb-manager.ps1"
)
if errorlevel 1 pause
