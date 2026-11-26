# CareSpeak ESP32 Wearable — Complete Build Guide
### For the user to share with ChatGPT (with photos of parts)

> **Goal:** Build the ESP32 patient wearable (heart rate + SpO₂ + SOS button + buzzer)
> and connect it to a laptop running CareSpeak fully offline. Total time: ~2–3 hours
> for a beginner.

---

## 0. What you are building (one paragraph)

A small wearable box the patient wears on the wrist. Inside: an ESP32 microcontroller
with Wi-Fi, a MAX30102 sensor that reads heart rate and blood oxygen from a finger,
a push button for SOS emergencies, and a buzzer that beeps locally. Every 15 seconds
it sends vitals over Wi-Fi (HTTP/JSON) to the CareSpeak app running on your laptop.
When the SOS button is pressed it instantly sends an EMERGENCY alert to the nurse
dashboard and beeps until acknowledged. The laptop also runs the AI (gesture/eye
tracking, voice) fully offline — no cloud, no internet needed after setup.

---

## 1. Identify your parts (photo guide for ChatGPT)

Send ChatGPT a photo of all parts laid out. Tell ChatGPT to identify each:

| Part | How it looks | How to tell it apart |
|---|---|---|
| **ESP32 DevKit V1** | Black PCB, ~5 cm × 2.8 cm, two rows of gold pins, USB port at top, "ESP32" silkscreen, antenna strip at bottom. | Has "EN" and "BOOT" buttons on board. 30 pins total (15 each side). |
| **MAX30102 module** | Small green or red PCB, ~1.3 cm square, 4 pins, black square sensor window with red LED. | Sensor window looks like a tiny dark glass. Pins labeled VIN/GND/SDA/SCL. |
| **Push button** | Tiny black square, 4 metal legs, clicks when pressed. | 6 mm × 6 mm. |
| **Active buzzer** | Black cylinder with a hole on top, 2 pins, ~12 mm diameter. | Has a sticker on top usually; "active" = beeps when 5 V applied (no signal needed). |
| **Breadboard** | White plastic rectangle with many holes and two red/blue power rails on sides. | 830 holes. |
| **Dupont wires** | Colored thin wires with plastic connectors at both ends (M-M, M-F, F-F). | |
| **18650 cell** | Silver metal cylinder, ~6.5 cm tall, 1.8 cm diameter, "18650" printed. | Heavier than it looks; has + and − ends. |
| **TP4056 module** | Small blue/red PCB, ~2.5 × 1.7 cm, USB port, 2 pads labeled B+/B−, 2 labeled OUT+/OUT−. | Has a tiny chip and one LED (red=charging, blue=done). |
| **18650 holder** | Black plastic cradle with two metal contacts and two wires (red/black). | Fits the cylinder. |
| **Perfboard** | Brown/green PCB with grid of holes (no copper traces between), ~10×15 cm. | Holes in 2.54 mm grid. |
| **Enclosure** | Small plastic box with lid, ~6×4×2.5 cm. | |
| **Wrist strap** | Velcro or silicone band. | |
| **USB cable** | Black/white cable with USB-A on one end and Micro-USB or Type-C on other. | Must be data cable (4 wires). |
| **Soldering iron** | Pen-like tool with metal tip, handle, power cord, stand. | |
| **Multimeter** | Handheld device with dial, screen, two probe wires (red/black). | |
| **Wire stripper** | Pliers-like with notched jaws and a cutter. | |
| **SSD1306 OLED** *(optional)* | Tiny blue/black screen module, ~2.7 cm square, 4 pins. | Screen shows pixels when powered. |

> **Safety first:** 18650 cells can short-circuit and catch fire if the + and −
> ends touch metal. Always keep the cell in its holder; never carry loose in a
> pocket with keys/coins. Charge only with TP4056 module. If the cell gets hot
> or swollen, stop immediately.

---

## 2. Step 1 — Power the ESP32 from USB (no wiring yet)

Goal: confirm the board works before adding anything.

1. Plug the ESP32 into your laptop with the USB data cable.
2. A red LED on the board should light up (power LED).
3. Open **Device Manager** (Windows key → type "Device Manager").
4. Look under "Ports (COM & LPT)". You should see something like
   "Silicon Labs CP210x USB to UART Bridge (COM5)" or "USB-SERIAL CH340 (COM5)".
   - **If nothing appears:** install the driver:
     - CP2102 → search "Silicon Labs CP210x driver" → download VCP driver.
     - CH340 → search "CH340 driver Windows" → download.
   - **If still nothing:** your cable is charge-only. Try another cable.
5. Note the COM port number (e.g. COM5). You'll need it later.

> **Do not** proceed until you see a COM port. This is the #1 blocker.

---

## 3. Step 2 — Install software on laptop (one time)

Install in this order:

1. **Python 3.10** → https://www.python.org/downloads/ → during install check
   "Add python.exe to PATH".
2. **Node.js LTS** → https://nodejs.org → default install.
3. **Git for Windows** → https://git-scm.com/download/win → default install
   (provides OpenSSL needed later).
4. **Ollama** → https://ollama.com/download → install, then open a terminal and run
   `ollama pull qwen2.5:3b` (downloads ~2 GB, one time).
5. **Arduino IDE 2.x** → https://www.arduino.cc/en/software → install.

Then in Arduino IDE:
- File → Preferences → "Additional Boards Manager URLs" → paste:
  `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
- Tools → Board → Boards Manager → search "esp32" → install "esp32 by Espressif Systems".
- Tools → Manage Libraries → search "SparkFun MAX3010x" → install.
- (Optional, only if you bought OLED) install "Adafruit SSD1306" and "Adafruit GFX Library".

---

## 4. Step 3 — Breadboard prototype (no soldering)

Build on breadboard first so you can test. Then solder the final wearable.

### 4.1 Wiring table (EXACT pins)

| MAX30102 pin | ESP32 pin | Wire color (suggested) |
|---|---|---|
| VIN | 3V3 | red |
| GND | GND | black |
| SDA | GPIO 21 | blue |
| SCL | GPIO 22 | yellow |

| Other part | ESP32 pin | Notes |
|---|---|---|
| SOS button leg 1 | GPIO 27 | |
| SOS button leg 2 | GND | uses internal pull-up, no resistor needed |
| Buzzer (+) | GPIO 25 | |
| Buzzer (−) | GND | |

### 4.2 Breadboard steps
1. Place ESP32 on breadboard straddling the center gap (so each side connects to different rails). Or use two breadboards side by side if it doesn't fit.
2. Place MAX30102 on breadboard.
3. Connect 3V3 → VIN with red wire.
4. Connect GND → GND with black wire.
5. Connect GPIO21 → SDA with blue wire.
6. Connect GPIO22 → SCL with yellow wire.
7. Place push button on breadboard. Connect one leg to GPIO27, opposite leg to GND. (Button orientation doesn't matter for 2-pin use.)
8. Place buzzer. Connect (+) to GPIO25, (−) to GND.
9. Double-check: no two wires touching, no wire in a hole that already has a pin.

### 4.3 Common mistakes
- Using 5 V (VIN pin) instead of 3V3 for MAX30102 → can damage it. Use 3V3.
- Forgetting common ground → sensor won't communicate.
- SDA/SCL swapped → I2C fails; swap and retry.
- Button wired to 3V3 instead of GND → won't work (firmware uses INPUT_PULLUP, expects button to GND).

---

## 5. Step 4 — Edit firmware config

Open `firmware/carespeak_esp32.ino` in Arduino IDE (or any text editor). Edit the config block at top:

```cpp
const char* WIFI_SSID     = "YOUR_WIFI_NAME";        // your Wi-Fi name
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";    // your Wi-Fi password
const char* SERVER_URL   = "http://192.168.1.5:3000/api/ingest";  // laptop LAN IP
const char* SESSION_ID   = "ABC123";                  // from patient screen
const char* DEVICE_ID    = "esp32_ward4_bed12";       // any unique name
const char* DEVICE_TOKEN = "";                        // "" = demo mode
```

**How to get each value:**
- **WIFI_SSID / PASSWORD:** your home Wi-Fi (2.4 GHz — ESP32 does NOT support 5 GHz). Phone hotspot works too.
- **SERVER_URL:** your laptop's LAN IP. On Windows: open cmd → `ipconfig` → look for "IPv4 Address" under Wi-Fi adapter (e.g. 192.168.1.5). Use `http://<that-ip>:3000/api/ingest`. ESP32 and laptop must be on same Wi-Fi.
- **SESSION_ID:** open CareSpeak in browser → go to `/hand-mode` or `/eye-mode` → a session ID like "CS-..." or "ABC123" is shown on screen. Copy exactly.
- **DEVICE_TOKEN:** leave "" for demo (open endpoint). For security set `CARESPEAK_DEVICE_TOKEN` in `.env.local` and put same value here.

---

## 6. Step 5 — Flash firmware

1. In Arduino IDE: Tools → Board → "ESP32 Dev Module".
2. Tools → Port → select your COM port (from Step 2).
3. Tools → Upload Speed → 115200.
4. Click the **Upload** button (right arrow). You'll see "Connecting........_" in console.
   - If it stalls: hold the **BOOT** button on ESP32 while uploading, release when "Writing..." appears.
5. Wait for "Hard resetting via RTS pin..." — done.
6. Open **Serial Monitor** (magnifying glass icon, top right). Set baud to **115200**.
7. You should see:
   ```
   Connecting to YOUR_WIFI....
   WiFi connected: 192.168.x.x
   POST vitals -> 200 ({"session":"...","type":"vitals",...})
   ```

**If you see "MAX30102 not found — check wiring":** recheck SDA/SCL/power. Try swapping SDA↔SCL. Check 3V3 (not 5 V).

---

## 7. Step 6 — Run the offline CareSpeak stack on laptop

In PowerShell, from the repo folder:

```powershell
./setup.ps1      # one time: installs Python venv, npm, Ollama model, models, certs
./start.ps1      # starts Ollama, backend, frontend, phone gateway
./health-check.ps1
```

Then open http://127.0.0.1:3000 in browser. Go to `/hand-mode`, allow camera. Note the session ID shown.

**For VoiceLink (AI calls):** also open http://127.0.0.1:3000/voicelink.

Make sure `SERVER_URL` in firmware matches laptop IP and CareSpeak is running (`npm run dev` or `start.ps1`).

---

## 8. Step 7 — Pair wearable to patient session

1. Laptop and ESP32 on **same Wi-Fi**.
2. Patient opens `/hand-mode` → session ID shown (e.g. "CS-ABC123").
3. Put that exact ID into firmware `SESSION_ID`, re-flash.
4. Reset ESP32 (press EN button or unplug/replug).
5. Watch Serial Monitor: "POST vitals -> 200".
6. Open nurse console `/nurse-view` → vitals card shows live BPM; SOS button press → EMERGENCY appears marked "wearable".

---

## 9. Step 8 — Test checklist

- [ ] Serial Monitor shows "WiFi connected".
- [ ] Serial Monitor shows "POST vitals -> 200" every 15 s.
- [ ] Place finger on MAX30102 sensor → BPM appears in serial and on nurse console.
- [ ] Remove finger → BPM goes to 0 / "finger removed".
- [ ] Press SOS button → buzzer beeps, Serial shows "!! SOS PRESSED", nurse console shows EMERGENCY.
- [ ] Nurse acknowledges → buzzer stops.
- [ ] Turn off laptop Wi-Fi → ESP32 retries; turn back on → posts resume.
- [ ] Offline: make hand gesture on patient laptop with Wi-Fi off → gesture queued in IndexedDB → reconnect → flushes.

---

## 10. Step 9 — Final wearable assembly (solder)

Only after breadboard works:

1. Solder ESP32 + MAX30102 + button + buzzer onto perfboard following the same wiring.
2. Use short wires; keep 3V3 and GND rails.
3. Add 18650 holder + TP4056 module for battery power:
   - Battery + → B+ on TP4056; Battery − → B−.
   - OUT+ → ESP32 VIN (or 5 V pin); OUT− → GND.
   - (Optional) add a small slide switch between OUT+ and ESP32 for power on/off.
4. Mount in enclosure with hot glue; cut a hole for USB port (charging) and sensor window (finger touches MAX30102).
5. Attach wrist strap.
6. Charge via TP4056 USB port. Power on via switch.

> **Battery safety:** never solder directly to 18650 cell; use holder. Don't over-discharge below 3.0 V. TP4056 with protection handles cutoff.

---

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| No COM port in Device Manager | Install CP2102/CH340 driver; try another USB cable (data, not charge-only). |
| "MAX30102 not found" | Check 3V3 power, common ground, SDA/SCL pins; try swapping SDA↔SCL. |
| WiFi FAILED in serial | SSID/password wrong, or 5 GHz network (use 2.4 GHz or phone hotspot). |
| POST vitals -> 0 or -1 | Server not running, wrong IP, firewall. Check `ipconfig`, ensure CareSpeak running on port 3000. |
| POST -> 401 | DEVICE_TOKEN mismatch; set both sides same or leave "" for demo. |
| BPM always 0 | Finger not on sensor properly; press firmly on black window; wait 5–10 s. |
| Buzzer won't stop | Nurse must acknowledge SOS on dashboard; or wait 60 s auto-clear. |
| Upload fails "Connecting..." | Hold BOOT button during upload; try lower upload speed 115200. |
| OLED blank (optional) | Check I2C address (0x3C vs 0x3D); install Adafruit libs. |

---

## 12. What ChatGPT should ask the user (if guiding live)

When the user sends photos, ChatGPT should:
1. Identify each part from the photo and confirm names.
2. Ask which USB type (Micro/Type-C) their ESP32 has → pick matching cable.
3. Ask their Wi-Fi name (2.4 GHz) and whether laptop/ESP32 share network.
4. Ask for the session ID shown on patient screen.
5. Walk through wiring one wire at a time, confirming each.
6. Verify Serial Monitor output before declaring success.
7. Only then guide soldering.

---

## 13. Files in repo relevant to hardware

- `docs/HARDWARE.md` — architecture, BOM, wiring, rural variants, demo script
- `firmware/carespeak_esp32.ino` — the firmware to flash
- `HARDWARE_REPORT.md` — tested machine specs
- `HARDWARE_SHOPPING_LIST.md` — what to buy
- `README.md` — overall project
- `README_VOICELINK.md` — offline AI stack

---

**End of guide.** Share this file + photos of your parts with ChatGPT and ask it to
walk you through step by step, starting from Step 1 (USB power test).
EOF
echo done