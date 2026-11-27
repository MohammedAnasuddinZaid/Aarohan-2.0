# CareSpeak Demo Checklist

## One-time setup (already done on this laptop)

- ESP32 paired with Windows as **CareSpeak-ESP32** (Bluetooth Classic SPP).
- Website runs locally on port 3000 with the in-memory store.
- Firmware v3.1.0 flashed; Wi-Fi and Bluetooth both work.

## Start the demo

1. Start the website (skip if it is already running):
   ```powershell
   cd "C:\Users\mohda\Desktop\projects\carespeak\CareSpeak-CALLING AGENT\CareSpeak"
   npm run dev -- -H 0.0.0.0
   ```
2. Make sure Windows Bluetooth is **On**.
3. Double-click **`START-BRIDGE.bat`**. Keep the window open.
4. Open:
   <http://localhost:3000/nurse-view?session=ZCAUEL6J>
5. Place a fingertip gently on the MAX30102 black window and hold still for
   15-20 seconds. The card should show **LIVE**, heart rate and SpO₂.

## Power modes

- **USB cable**: bridge uses the CP210x COM port.
- **Battery / untethered**: bridge automatically switches to the Bluetooth
  virtual COM port. No venue Wi-Fi, hotspot or mobile data needed.
- When Bluetooth connects, the firmware pauses Wi-Fi to save battery and free
  memory. Wi-Fi resumes when the Bluetooth client disconnects.

## If data stops

- Check that the bridge window still says `POST ok` every 5 seconds.
- If it says no port found: turn Bluetooth on, or plug in USB.
- Do not open the Arduino Serial Monitor while the bridge is running; it takes
  the COM port and resets the board.
- The bridge finds the ESP32 Bluetooth port by MAC address, so a changed COM
  number is handled automatically.

## Phone / calling demo

The calling feature needs the laptop's mobile data or internet. The wearable
vitals path itself is local (USB or Bluetooth) and does not use that connection.
