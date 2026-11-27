# CareSpeak Demo Checklist

## One-time setup (already done on this laptop)

- ESP32 paired with Windows as **CareSpeak-ESP32** (Bluetooth Classic SPP).
- Website runs locally on port 3000 with the in-memory store.
- Firmware v3.1.0 flashed; Wi-Fi and Bluetooth both work.
- Desktop shortcut **"CareSpeak Demo"** created.

## Start the demo (one click)

1. Make sure the ESP32 is **powered on** (battery charged, LED blinking).
2. Make sure Windows **Bluetooth is ON**.
3. Double-click **`CareSpeak Demo`** on the Desktop (or `START-DEMO.bat`).
   - It auto-connects Bluetooth to the ESP32, starts the website + bridge, and opens the dashboard.
4. Place a fingertip gently and **flat** on the MAX30102 black window (the side with the tiny glass square). Hold still for 15-20 s. Don't press hard.
5. The card should show **LIVE**, heart rate and SpO₂.

## Important: do NOT click "Connect" in Windows Bluetooth settings

For a Serial Port Profile (SPP) device, the Windows Settings "Connect" button usually fails with "Couldn't connect". The connection is established automatically when an app opens the virtual COM port — the launcher and the bridge do this. Just run the launcher.

## Power modes

- **USB cable**: bridge uses the CP210x COM port (preferred when available).
- **Battery / untethered**: bridge automatically switches to the Bluetooth virtual COM port. No venue Wi-Fi, hotspot or mobile data needed for vitals.
- When Bluetooth connects, the firmware pauses Wi-Fi to save battery and free memory. Wi-Fi resumes when the Bluetooth client disconnects.

## Calling demo (needs mobile data / internet)

The free browser call at `/care/phone?session=ZCAUEL6J` works locally. The Twilio phone path needs the laptop's mobile data or internet; the wearable vitals path does not.

## If readings stop

- Check that a bridge window says `POST ok` every 5 seconds.
- If the bridge window is gone or says no port: re-run `START-DEMO.bat` (it detects a dead bridge and starts a new one).
- Do not open the Arduino Serial Monitor while the bridge is running; it takes the COM port and resets the board.
- The bridge finds the ESP32 Bluetooth port by MAC address, so a changed COM number is handled automatically.
- If Bluetooth won't auto-connect: turn Bluetooth OFF then ON in Windows Settings, ensure `CareSpeak-ESP32` shows as Paired, then re-run the launcher.
- If the ESP32 keeps resetting on battery: charge the 18650 fully; brownout under Wi-Fi TX is the known risk. Bluetooth-only mode reduces current draw.

## Finger placement tips

- Use the **index or middle finger** of either hand.
- Cover the black window completely; keep the finger **flat and still**.
- Light pressure only — pressing hard cuts off blood flow and gives 0 / wrong readings.
- Wait 15-20 s for the algorithm to lock; HR appears first, then SpO₂.
- Lifting the finger clears HR and SpO₂ on the card (expected).
