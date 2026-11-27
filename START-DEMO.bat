@echo off
title CareSpeak Demo Launcher
cd /d "%~dp0"
echo ============================================================
echo  CareSpeak demo launcher
echo  Starts the local website + USB/Bluetooth bridge,
echo  then opens the nurse dashboard.
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-DEMO.ps1"
echo.
echo Launcher finished. You can close this window.
pause >nul