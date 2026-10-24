@echo off
chcp 65001 >nul
node "%~dp0tools\install-st-reasoning.mjs" %*
pause
