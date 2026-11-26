# CareSpeak ESP32 Local Dashboard

Standalone receiver + live dashboard for the ESP32 wearable. Runs on your PC,
no database, no login, no internet required (LAN only).

## Run

```bat
start.bat
```
or
```bat
node server.js
```

Then open **http://localhost:3000** (or `http://<your-pc-ip>:3000` from a phone
on the same Wi-Fi).

## Endpoints

| Method | Path          | Purpose                                   |
|--------|---------------|-------------------------------------------|
| POST   | `/api/ingest` | ESP32 sends vitals / SOS JSON here        |
| GET    | `/api/vitals` | Dashboard polls latest vitals + SOS list  |
| GET    | `/`           | Dashboard HTML                            |

## ESP32 side

In `carespeak_esp32.ino` set:

```cpp
#define USE_LOCAL_DASHBOARD 1
constexpr char SERVER_URL[] = "http://<your-pc-ip>:3000/api/ingest";
```

Use your PC's Wi-Fi IPv4 address from `ipconfig` (e.g. `192.168.0.144`).
ESP32 and PC must be on the same network (they are if both get `192.168.0.x`).

## Dashboard behaviour

- Polls every **1 second**.
- Shows `--` for HR / SpO2 / Battery whenever no finger is detected.
- Marks the device **offline** if no packet arrives for 15 seconds, clears the
  stale values and logs the silence.
- Logs every packet (and the `(no finger)` state) in the Event Log.

## CareSpeak forwarding

Every packet is mirrored to the deployed CareSpeak app
(`https://carespeak-artificial.vercel.app/api/ingest`) with the device token,
so the wearable is already wired for the CareSpeak integration.

If CareSpeak returns 500, check the server log line:

```
↳ CareSpeak 500
```

That is a backend issue, not the ESP32. (Current known cause: Upstash Redis
free-tier request quota exhausted.) Options: wait for the monthly reset, add a
payment method to Upstash, or delete and recreate the free database.

## Payloads

Vitals:
```json
{"session":"ZCAUEL6J","deviceId":"esp32_mohd_bed1","type":"vitals","heartRate":76,"spo2":97,"finger":true,"sosActive":false,"rssi":-58}
```

SOS:
```json
{"session":"ZCAUEL6J","deviceId":"esp32_mohd_bed1","type":"sos"}
```

## When you move to CareSpeak only

Flip the firmware switch:

```cpp
#define USE_LOCAL_DASHBOARD 0
```

That sends the ESP32 straight to the deployed app. The local server can then be
stopped.

## Battery / power note (important)

The TP4056 `OUT+` is **battery voltage** (3.7-4.2 V), not 5 V. Feeding it
directly into the ESP32 DevKit `5V` pin makes the onboard AMS1117 regulator
sag below 3.0 V as the cell drains, which causes Wi-Fi brownouts and the
device to go silent. Fix:

- Use a **5 V boost module** (MT3608, set to 5.0 V) between TP4056 OUT and
  the ESP32 5V pin, or
- Power the ESP32 from a 5 V USB power bank for testing.

The firmware logs `Reset reason: 9` when it reboots from a brownout.
`Reset reason: 6` or `5` means the watchdog caught a stuck loop / I2C bus.
Both are recovered automatically (Wi-Fi reconnect at 60 s, full restart at 3 min).

## If your PC IP changes (DHCP)

Run `ipconfig` → get new IPv4 → update `SERVER_URL` in the `.ino` → reflash.
The server itself binds to `0.0.0.0` and needs no change.

## Reflash commands

```bat
C:\Users\mohda\arduino-cli\arduino-cli.exe compile --fqbn esp32:esp32:esp32 C:\Users\mohda\arduino-sketches\carespeak_esp32
C:\Users\mohda\arduino-cli\arduino-cli.exe upload --fqbn esp32:esp32:esp32 --port COM10 C:\Users\mohda\arduino-sketches\carespeak_esp32
```

Close the Serial Monitor before uploading.

## Wiring

- MAX30102: VIN→3V3, GND→GND, SDA→GPIO21, SCL→GPIO22
- SOS button: GPIO27→GND (only if `ENABLE_SOS_BUTTON 1`)
- Active buzzer: GPIO25 (+), other leg→GND
- Battery divider (optional): GPIO34, 100k/100k (`ENABLE_BATTERY 1`)
