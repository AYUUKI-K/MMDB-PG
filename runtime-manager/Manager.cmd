@echo off
setlocal
chcp 65001 >nul
title MMDB Runtime Manager
cd /d "%~dp0"
echo MMDB Runtime Manager
echo.
node cli.mjs open
set "managerExit=%errorlevel%"
echo.
pause
exit /b %managerExit%
