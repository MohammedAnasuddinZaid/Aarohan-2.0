@echo off
title CareSpeak Wearable Bridge - USB / Bluetooth
cd /d "%~dp0"
echo ============================================================
echo  CareSpeak wearable bridge
echo  USB serial or Bluetooth - no Wi-Fi or internet required
echo  Keep this window open during the demo.
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serial-bridge.ps1"
echo.
echo Bridge stopped. Press any key to close.
pause >nul
