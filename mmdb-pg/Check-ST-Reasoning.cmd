@echo off
chcp 65001 >nul
node "%~dp0tools\check-st-reasoning.mjs" %*
pause
