@echo off
echo Starting CareSpeak ESP32 Vitals Dashboard Server...
echo.
echo Find your PC IP address:
ipconfig | findstr "IPv4"
echo.
echo Update the ESP32 firmware SERVER_URL to: http://<your-ip>:3000/api/ingest
echo Then reflash and open http://localhost:3000 in your browser.
echo.
node server.js