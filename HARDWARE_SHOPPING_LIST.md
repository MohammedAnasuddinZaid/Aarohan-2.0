# CareSpeak — Offline Hardware Shopping List (Hyderabad, India)

Everything needed to build the **ESP32 wearable** + run the **fully offline**
CareSpeak/VoiceLink stack on your laptop. Prices are typical India market
(2026); buy from the sources listed at the bottom.

> You don't have anything yet → start with **Section 1 (core wearable)** +
> **Section 2 (tools)** + **Section 3 (laptop/PC)**. Optional sections 4–5
> come later.

---

## 1. ESP32 wearable — Bill of Materials (per bed, ~₹1,100)

From `docs/HARDWARE.md`. Build on a breadboard first, then solder.

| # | Part | Qty | Est. ₹ | Purpose |
|---|---|---|---|---|
| 1 | **ESP32 DevKit V1** (30-pin, CP2102 or CH340 USB) | 1 | 320–450 | MCU + Wi-Fi; talks to `/api/ingest` |
| 2 | **MAX30102** pulse/SpO₂ module (I²C) | 1 | 120–200 | Heart rate + oxygen |
| 3 | Push button (6 mm tactile, momentary) | 1 | 5–10 | Physical SOS |
| 4 | Active buzzer (5 V) | 1 | 20–40 | Local alarm feedback |
| 5 | **SSD1306 0.96" OLED** (I²C, 128×64) *(optional)* | 1 | 150–250 | Shows session ID + HR |
| 6 | 18650 Li-ion cell (genuine Samsung/LG/Panasonic, 2500+ mAh) | 1 | 150–250 | Portable power |
| 7 | TP4056 charging module (with protection) | 1 | 20–40 | Charge the 18650 |
| 8 | 18650 battery holder (with leads) | 1 | 20–40 | Mount cell |
| 9 | Jumper wires (dupont M-M, M-F, F-F, 40 each) | 1 set | 60–120 | Prototyping |
| 10 | Breadboard (830 tie-points) | 1 | 80–150 | Prototype before soldering |
| 11 | Strap (wrist/strap band) + small enclosure (plastic box) | 1 | 100–200 | Wearable assembly |
| 12 | Perfboard (10×15 cm) + standoffs | 1 | 30–60 | Final soldered board |

**Wiring (from firmware):**
- MAX30102: VIN→3V3, GND→GND, SDA→GPIO21, SCL→GPIO22
- SOS button: GPIO27 → GND (internal pull-up)
- Buzzer (+): GPIO25 (active buzzer)

---

## 2. Tools to assemble & debug (one-time, ~₹1,200–1,800)

| Tool | Est. ₹ | Why |
|---|---|---|
| Soldering iron kit (30–60 W, with stand, sponge, solder wire, flux) | 400–800 | Final wearable assembly |
| Digital multimeter (auto-ranging) | 300–600 | Check voltage, continuity, I²C |
| Wire stripper + cutter | 150–250 | Clean jumper prep |
| Precision screwdriver set | 150–250 | Enclosure screws |
| Hot-glue gun + sticks | 150–250 | Strain relief / mounting |
| Anti-static wrist strap *(optional)* | 100–150 | ESD protection |
| Magnifying glass / headband *(optional)* | 200–400 | Soldering small parts |

---

## 3. To flash code from your laptop (USB + software)

### Hardware
| Item | Est. ₹ | Notes |
|---|---|---|
| **USB data cable** (micro-USB **or** USB-C, depending on your ESP32 board) | 80–200 | ⚠️ Must be a **data** cable, not charge-only |
| USB hub (if your laptop has few ports) *(optional)* | 300–600 | |

### Software (all free, install once)
1. **Python 3.10** — https://www.python.org/downloads/release/python-31011/ (must be 3.10 for VoiceLink backend)
2. **Node.js LTS (v20+)** — https://nodejs.org
3. **Git for Windows** — https://git-scm.com/download/win (provides OpenSSL for local HTTPS certs)
4. **Ollama** — https://ollama.com/download (local LLM runtime)
5. **Arduino IDE 2.x** — https://www.arduino.cc/en/software **OR** VS Code + PlatformIO
6. **ESP32 board package** in Arduino IDE:
   - File → Preferences → Additional Boards Manager URLs:
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Boards Manager → install "esp32" by Espressif
7. **Libraries** (Library Manager):
   - `SparkFun MAX3010x` (provides `MAX30105.h` + `heartRate.h`)
   - `Adafruit SSD1306` + `Adafruit GFX` (only if you add the optional OLED)
8. **USB drivers** (install the one matching your board's chip):
   - CP2102 → Silicon Labs CP210x driver
   - CH340 → CH340 driver
9. **arduino-cli** *(optional, for letting OpenCode flash from terminal)* — https://arduino.github.io/arduino-cli/

### Laptop / PC minimum specs (for the offline stack)
| Resource | Minimum | Recommended |
|---|---|---|
| CPU | Intel i5 8th gen / Ryzen 5 | i5 12th gen+ (like Dell G15) |
| RAM | 8 GB | 16 GB (Ollama qwen2.5:3b ~4–6 GB + whisper ~1 GB) |
| Storage | 10 GB free | 20 GB (models ~270 MB + node_modules) |
| OS | Windows 10/11 64-bit | Windows 11 |
| Network | Wi-Fi (2.4/5 GHz) | Same Wi-Fi for phone + ESP32 + laptop |
| Webcam | Any USB/built-in | For gesture AI |
| Microphone | Built-in OK | USB mic / headset for VoiceLink (₹500–1500) |
| Speakers | Built-in OK | Headphones for privacy |

> If your laptop is 8 GB RAM, switch Ollama model to `qwen2.5:1.5b` or
> `phi3:mini` in `.env.voicelink` to avoid memory pressure.

---

## 4. Optional upgrades

| Upgrade | Est. ₹ | When you need it |
|---|---|---|
| LoRa SX1278 module ×2 (node + gateway) | 500 (pair) | No-Wi-Fi wards (rural variant) |
| SIM800L GSM module + SIM | 220 + SIM | Ambulance / cellular backhaul |
| Raspberry Pi 4/5 (as LoRa gateway) | 4,500–7,000 | Rural gateway that POSTs to `/api/ingest` |
| Better USB microphone | 500–1,500 | VoiceLink calls |
| Power bank (10,000 mAh, 5 V USB) | 700–1,200 | Field testing without 18650 |
| Second ESP32 (spare / second bed) | 320–450 | Multi-bed ward demo |
| 3D-printed enclosure | 200–500 (print service) | Cleaner wearable |

---

## 5. Where to buy in Hyderabad

**Online (fastest, 2–5 days to Hyderabad):**
- **Robu.in** (Pune) — best for ESP32, sensors, modules; GST invoice
- **Robocraze** (Bengaluru) — good stock, quick shipping
- **Evelta / ThinkRobotics** — modules & tools
- **Amazon.in / Flipkart** — cables, tools, multimeters, 18650 cells (verify genuine)
- **Ollama / Python / Node / Arduino** — direct downloads (free)

**Local Hyderabad shops (same-day, walk-in):**
- **Abids / Begum Bazaar** electronics market — components, wires, soldering tools
- **Secunderabad** — Patny Centre, General Bazaar (electronic components)
- **Ameerpet** area computer shops — USB cables, hubs, peripherals
- Tip: For 18650 cells, prefer reputable online (Robu) to avoid fake/used cells.

---

## 6. Total cost to start (one bed + tools + flashing)

| Bucket | ₹ |
|---|---|
| Core wearable (min, no OLED) | ~900 |
| Core wearable (full, with OLED + enclosure) | ~1,150 |
| Assembly/debug tools (one-time) | ~1,300 |
| USB cable + (optional) hub | ~150 |
| Laptop software | 0 |
| **Total to be fully set up** | **~₹2,300–2,600** |

Offline stack (VoiceLink) needs **no paid service** — Ollama, whisper.cpp,
sherpa-onnx, SQLite are all free and run locally. Network during setup only
(downloads); after that it runs with no internet.

---

## 7. What to do after you buy (so OpenCode can flash & run)

1. Plug ESP32 into laptop via USB data cable. Note the **COM port** in
   Device Manager (e.g. `COM5`).
2. Install Arduino IDE 2.x + ESP32 board package + SparkFun MAX3010x library.
3. Open `firmware/carespeak_esp32.ino` from the repo, edit the config block:
   - `WIFI_SSID`, `WIFI_PASSWORD`
   - `SERVER_URL` (your laptop's LAN IP, e.g. `http://192.168.1.5:3000/api/ingest`)
   - `SESSION_ID` (must match the session shown on the patient screen)
   - `DEVICE_TOKEN` (match `CARESPEAK_DEVICE_TOKEN` in `.env.local`, or leave `""` for demo mode)
4. Select board: **ESP32 Dev Module**, port: your COM port, baud: **115200**.
5. Click Upload. Open Serial Monitor (115200) to verify posts.
6. Run the offline stack:
   ```powershell
   ./setup.ps1   # one time
   ./start.ps1   # starts Ollama, backend, frontend, phone gateway
   ```
7. Put ESP32 and laptop on the **same Wi-Fi**; the wearable will POST vitals/SOS
   to your laptop, and the nurse console will show them live.

> Once the ESP32 is plugged in and you tell me the COM port, I can compile &
> upload the firmware from the terminal using `arduino-cli` (if installed) and
> help debug Serial output. I cannot physically receive hardware — it stays on
> your machine; I work with it through your terminal.

---

## 8. Quick checklist (tick as you buy)

- [ ] ESP32 DevKit V1
- [ ] MAX30102 module
- [ ] Push button
- [ ] Active buzzer
- [ ] Jumper wires + breadboard
- [ ] 18650 cell + TP4056 + holder
- [ ] Strap + enclosure
- [ ] Perfboard (for final build)
- [ ] USB data cable (micro/Type-C)
- [ ] Soldering iron kit + solder
- [ ] Multimeter
- [ ] Wire stripper
- [ ] (Optional) SSD1306 OLED
- [ ] (Optional) LoRa/GSM for no-Wi-Fi
- [ ] (Optional) USB microphone
- [ ] Python 3.10, Node.js, Git, Ollama, Arduino IDE installed
EOF
echo done