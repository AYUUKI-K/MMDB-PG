@echo off
setlocal
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 or newer, then retry.
  pause
  exit /b 1
)
node "%~dp0tools\windows-update-repair.mjs"
set "repairResult=%errorlevel%"
pause
exit /b %repairResult%
