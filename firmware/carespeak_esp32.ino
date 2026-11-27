/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  CareSpeak Wearable — ESP32 patient-side unit (SIH 2026)
 *  Firmware v2.1.0
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Hardware
 *    ESP32 DevKit V1 (30-pin, CP2102)
 *    MAX30102  HR / SpO2 .... VIN->3V3  GND->GND  SDA->GPIO21  SCL->GPIO22
 *    SOS button ............. GPIO27 -> GND (INPUT_PULLUP, no resistor)
 *    Active buzzer .......... GPIO25 (+), other leg -> GND
 *    Battery ADC (optional) . GPIO34, 100k/100k divider (set ENABLE_BATTERY 1)
 *
 *  Behaviour
 *    - Non-blocking Wi-Fi state machine: boot is instant; an SOS press is
 *      dispatched even while Wi-Fi is still connecting.
 *    - Streams HR / SpO2 / battery / RSSI as JSON to POST /api/ingest.
 *    - SOS press -> immediate EMERGENCY, local buzzer, retries until HTTP 2xx.
 *    - Sensor missing -> keeps running and retries detection every 10 s.
 *    - loop() never blocks for more than a few milliseconds.
 *
 *  Libraries (install once)
 *    - SparkFun MAX3010x Pulse and Proximity Sensor Library
 *    - ArduinoJson v7
 *
 *  Security note
 *    TLS runs setInsecure() because the board has no RTC to validate a
 *    certificate chain. The shared x-device-token is the authentication
 *    boundary. For production, pin the server root CA and add NTP time sync.
 * ─────────────────────────────────────────────────────────────────────────────
 */

#include <WiFi.h>
#include <WiFiUdp.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "BluetoothSerial.h"
#include <Wire.h>
#include <ArduinoJson.h>
#include <EEPROM.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <esp_wifi.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "spo2_algorithm.h"

// ═════════════════════════════════════════════════════════════════════════════
//  1. USER CONFIGURATION — edit only this block
// ═════════════════════════════════════════════════════════════════════════════
constexpr char FW_VERSION[] = "3.1.0";

// Wi-Fi credentials: the firmware tries each in order until one connects.
// Only 2.4 GHz networks are visible to the ESP32. The USB serial bridge works
// even if every entry here fails (see tools/serial-bridge.ps1).
struct WifiCred { const char* ssid; const char* pass; };
static const WifiCred WIFI_CREDS[] = {
  // Home / demo Wi-Fi
  { "Anas", "osssa1920" },
  // Known venue networks (passwords copied from this laptop's saved profiles)
  { "Aarohan 8", "Pragnya@6844" },
  { "HACKATHON_3", "03042026" },
  { "FSWxSIH 5", "fsw@4664" },
  { "NRCM IT PARK 2.4G", "CODE@5454" },
  // Phone hotspots
  { "Mohdanasuddinzaid's A15", "ossa1920" },
  { "M0hdanasuddinzaid's A15", "ossa1920" },
  // Laptop-hosted hotspot (tools/hotspot.ps1) — zero-infrastructure fallback
  { "CareSpeak-Demo", "carespeak2026" },
};
static const uint8_t WIFI_CRED_COUNT = sizeof(WIFI_CREDS) / sizeof(WIFI_CREDS[0]);

// Server: auto-discover on local network. Set to a fixed URL to skip discovery.
constexpr char SERVER_URL_OVERRIDE[] = "";

// UDP broadcast discovery: tools/demo-runtime.mjs answers "CARESPEAK:<ip>".
constexpr uint16_t DISCOVERY_PORT       = 41234;
constexpr uint16_t DISCOVERY_LOCAL_PORT = 41235;
constexpr uint32_t REDISCOVER_AFTER_MS  = 30000;   // no successful POST -> rescan
constexpr wifi_power_t WIFI_TX_POWER    = WIFI_POWER_15dBm;  // lower peak current on battery

// Server URL: mutable, set during discovery or from override.
char SERVER_URL[128] = "";
constexpr char SESSION_ID[]    = "ZCAUEL6J";          // session shown on patient screen
constexpr char DEVICE_ID[]     = "esp32_mohd_bed1";
constexpr char DEVICE_TOKEN[]  = "937a7b8ba22a6b61643d506fa534452e8b2f2309443bc1c4acaed1692d51f396";

// Pins
constexpr uint8_t PIN_SOS_BUTTON = 27;
constexpr uint8_t PIN_BUZZER     = 25;
constexpr uint8_t PIN_I2C_SDA    = 21;
constexpr uint8_t PIN_I2C_SCL    = 22;
constexpr uint8_t PIN_BATTERY    = 34;    // only used when ENABLE_BATTERY == 1

// EEPROM settings
#define EEPROM_SIZE 256
#define EEPROM_URL_ADDR 0
#define ENABLE_WIFI_SCAN 0   // set 1 only for one-off Wi-Fi debugging
#define DEBUG_SENSOR     1   // 1 = print raw red/IR once a second
#define ENABLE_SOS_BUTTON 0  // set 1 when a push button is wired to GPIO27->GND
#define ENABLE_BT_SERIAL 1   // Bluetooth Classic SPP -> virtual COM port on the laptop

// Timing (milliseconds)
constexpr uint32_t POST_INTERVAL_MS       = 5000;   // 5 s: live dashboard, small packet
constexpr uint32_t SOS_RETRY_MS           = 4000;
constexpr uint32_t SOS_LATCH_MS           = 60000;
constexpr uint32_t SOS_BUZZER_MS          = 30000;
constexpr uint32_t SOS_DEBOUNCE_MS        = 500;   // very long debounce: kills false triggers on battery noise
constexpr uint32_t WIFI_CONNECT_TIMEOUT   = 15000;
constexpr uint32_t SENSOR_RETRY_MS        = 10000;
constexpr uint32_t HTTP_TIMEOUT_MS        = 6000;
constexpr uint32_t HTTP_CONNECT_TIMEOUT_MS = 4000;
constexpr uint32_t NET_RECOVERY_MS        = 90000;  // no successful POST for 90 s -> force Wi-Fi reconnect
constexpr uint32_t REBOOT_AFTER_MS        = 300000; // still no POST after 5 min -> full restart
constexpr uint32_t LOOP_STALL_MS          = 45000;  // hardware-timer watchdog: loop stuck -> restart

// ═════════════════════════════════════════════════════════════════════════════
//  2. LOGGING
// ═════════════════════════════════════════════════════════════════════════════
#define LOG(fmt, ...) Serial.printf("[%8lu] " fmt, static_cast<unsigned long>(millis()), ##__VA_ARGS__)

#if ENABLE_BT_SERIAL
// Windows exposes a paired Bluetooth Classic SPP device as a virtual COM port,
// so tools/serial-bridge.ps1 can forward these packets with no Wi-Fi at all.
BluetoothSerial SerialBT;
#endif

// ═════════════════════════════════════════════════════════════════════════════
//  3. STATE
// ═════════════════════════════════════════════════════════════════════════════
enum class WifiState : uint8_t { Idle, Connecting, Connected };

static WifiState wifiState        = WifiState::Idle;
static uint32_t wifiStartedAt     = 0;
static uint32_t wifiNextAttemptAt = 0;
static uint8_t  wifiBackoffStep   = 0;
static bool     wifiManuallyDisabled = false;
static bool     wifiPausedForBt    = false;  // Bluetooth client active -> radio shared
static uint32_t lastWifiRecycleAt = 0;

static bool     sensorReady        = false;
static uint32_t lastSensorAttempt  = 0;

static uint32_t lastVitalsPost     = 0;
static uint32_t bootAt             = 0;
static uint32_t lastPostOkAt       = 0;
static uint32_t lastPostTryAt      = 0;
static uint32_t lastNetRecoveryAt   = 0;
static uint8_t  postFailStreak     = 0;
static volatile uint32_t loopHeartbeatMs = 0;

static bool     sosLatched         = false;
static bool     sosPending         = false;
static uint32_t sosLatchedAt       = 0;
static uint32_t lastSosAttempt     = 0;

// Heart rate
static MAX30105 particleSensor;
static constexpr uint8_t RATE_SIZE = 5;
static uint8_t  rates[RATE_SIZE]   = {0};
static uint8_t  rateSpot           = 0;
static uint8_t  rateCount          = 0;
static int      beatAvg            = 0;
static uint32_t lastBeatMs         = 0;
static uint32_t fingerPresentSince = 0;

// SpO2 (ratio-of-ratios over a ~1 s window)
static constexpr uint16_t SPO2_WINDOW = 100;
static float   spo2Red[SPO2_WINDOW];
static float   spo2Ir[SPO2_WINDOW];
static uint16_t spo2Index          = 0;
static uint16_t spo2Count          = 0;
static double  spo2SumRed          = 0;
static double  spo2SumIr           = 0;
static double  spo2SumSqRed        = 0;
static double  spo2SumSqIr         = 0;
static int     spo2Value           = 0;

static bool     fingerPresent      = false;
static bool     sensorCleared      = true;
static uint32_t fingerLostAt       = 0;

// Maxim reference algorithm — 100 samples at 25 Hz = 4 s window.
// This is the same algorithm used by the sensor vendor's reference design and
// is far more reliable than a fixed-threshold beat detector.
static uint32_t maximIr[100];
static uint32_t maximRed[100];
static uint32_t maximIrCopy[100];
static uint32_t maximRedCopy[100];
static uint16_t maximPos           = 0;
static uint16_t maximFilled        = 0;
static uint32_t lastMaximCalc      = 0;
static int32_t  maximHr            = 0;
static int32_t  maximSpo2          = 0;
static int8_t   maximHrValid       = 0;
static int8_t   maximSpo2Valid     = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  4. SMALL HELPERS
// ═════════════════════════════════════════════════════════════════════════════
static inline bool timeReached(uint32_t now, uint32_t target) {
  return static_cast<int32_t>(now - target) >= 0;
}

static void configWarnings() {
  if (WIFI_CRED_COUNT == 0)        LOG("CONFIG: no Wi-Fi credentials defined\n");
  if (strlen(SESSION_ID) < 3)      LOG("CONFIG: SESSION_ID looks too short\n");
  if (strlen(DEVICE_ID) == 0)      LOG("CONFIG: DEVICE_ID is empty\n");
  if (strlen(DEVICE_TOKEN) == 0)   LOG("CONFIG: DEVICE_TOKEN is empty\n");
}

// ═════════════════════════════════════════════════════════════════════════════
//  4b. SELF-RECOVERY WATCHDOG
//  Runs from the esp_timer task, so it still fires if the main loop is stuck
//  inside a blocking I2C/Wi-Fi call. A stuck loop is restarted after 45 s.
// ═════════════════════════════════════════════════════════════════════════════
// Load saved server URL from EEPROM.
static void loadServerUrl() {
  EEPROM.begin(EEPROM_SIZE);
  char buf[128];
  for (int i = 0; i < 127; i++) {
    buf[i] = EEPROM.read(EEPROM_URL_ADDR + i);
    if (buf[i] == '\0') break;
  }
  buf[127] = '\0';
  if (strlen(buf) > 10 && strstr(buf, "http") == buf) {
    strlcpy(SERVER_URL, buf, sizeof(SERVER_URL));
    LOG("Server: loaded from EEPROM: %s\n", SERVER_URL);
  }
  EEPROM.end();
}

// Save server URL to EEPROM.
static void saveServerUrl(const char* url) {
  EEPROM.begin(EEPROM_SIZE);
  for (int i = 0; i < 127; i++) {
    EEPROM.write(EEPROM_URL_ADDR + i, url[i]);
    if (url[i] == '\0') break;
  }
  EEPROM.write(EEPROM_URL_ADDR + 127, '\0');
  EEPROM.commit();
  EEPROM.end();
  LOG("Server: saved to EEPROM\n");
}

static void hardRestart(const char* reason) {
  LOG("RESTART: %s\n", reason);
  delay(200);
  ESP.restart();
}

static void loopWatchdogCb(void*) {
  const uint32_t now = millis();
  if (static_cast<uint32_t>(now - loopHeartbeatMs) > LOOP_STALL_MS) {
    ESP.restart();
  }
}

static esp_timer_handle_t loopWatchdog = nullptr;

static void startLoopWatchdog() {
  esp_timer_create_args_t args = {};
  args.callback = &loopWatchdogCb;
  args.arg = nullptr;
  args.dispatch_method = ESP_TIMER_TASK;
  args.name = "loop_wdt";
  args.skip_unhandled_events = true;
  if (esp_timer_create(&args, &loopWatchdog) == ESP_OK) {
    esp_timer_start_periodic(loopWatchdog, 5000000ULL);  // check every 5 s
    LOG("Watchdog: armed (loop stall > %lu s)\n",
        static_cast<unsigned long>(LOOP_STALL_MS / 1000));
  } else {
    LOG("Watchdog: create failed\n");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  5. WI-FI — non-blocking state machine
// ═════════════════════════════════════════════════════════════════════════════
static void discoverServer();  // forward declaration
static void wifiStart(uint32_t now);  // forward declaration

static void wifiStart(uint32_t now) {
  if (wifiManuallyDisabled || wifiPausedForBt) return;

  LOG("Wi-Fi: scanning for known networks...\n");

  WiFi.persistent(false);
  WiFi.disconnect(true, false);
  delay(50);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.setHostname("carespeak-esp32");
  WiFi.setTxPower(WIFI_TX_POWER);

  int found = WiFi.scanNetworks();
  if (found < 0) found = 0;
  LOG("Wi-Fi: %d networks visible\n", found);

  bool connected = false;
  for (uint8_t c = 0; c < WIFI_CRED_COUNT && !connected; ++c) {
    bool visible = false;
    int bestRssi = -127;
    for (int i = 0; i < found; ++i) {
      if (WiFi.SSID(i).equalsIgnoreCase(WIFI_CREDS[c].ssid)) {
        visible = true;
        if (WiFi.RSSI(i) > bestRssi) bestRssi = WiFi.RSSI(i);
      }
    }
    if (!visible) {
      LOG("Wi-Fi: \"%s\" not visible, skipping\n", WIFI_CREDS[c].ssid);
      continue;
    }

    LOG("Wi-Fi: \"%s\" visible (%d dBm), connecting...\n", WIFI_CREDS[c].ssid, bestRssi);
    WiFi.begin(WIFI_CREDS[c].ssid, WIFI_CREDS[c].pass);
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT) {
      delay(100);
      loopHeartbeatMs = millis();
    }
    if (WiFi.status() == WL_CONNECTED) {
      connected = true;
      LOG("Wi-Fi: connected to \"%s\", IP %s, RSSI %d dBm\n",
          WIFI_CREDS[c].ssid, WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
      LOG("Wi-Fi: \"%s\" failed (status %d)\n", WIFI_CREDS[c].ssid, WiFi.status());
      WiFi.disconnect(true, false);
      delay(100);
    }
  }

  // Open venue network as a last resort (no password).
  if (!connected) {
    for (int i = 0; i < found && !connected; ++i) {
      if (WiFi.encryptionType(i) != WIFI_AUTH_OPEN) continue;
      String ssid = WiFi.SSID(i);
      if (ssid.length() == 0) continue;
      LOG("Wi-Fi: trying open network \"%s\"...\n", ssid.c_str());
      WiFi.begin(ssid.c_str());
      uint32_t start = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
        delay(100);
        loopHeartbeatMs = millis();
      }
      if (WiFi.status() == WL_CONNECTED) {
        connected = true;
        LOG("Wi-Fi: connected to open network \"%s\", IP %s\n",
            ssid.c_str(), WiFi.localIP().toString().c_str());
      } else {
        WiFi.disconnect(true, false);
      }
    }
  }

  WiFi.scanDelete();

  if (!connected) {
    LOG("Wi-Fi: no usable network found, retrying in 10 s\n");
    wifiState = WifiState::Idle;
    wifiNextAttemptAt = now + 10000;
    return;
  }

  wifiState = WifiState::Connected;
  wifiBackoffStep = 0;
  lastVitalsPost = now - POST_INTERVAL_MS + 1000UL;
  lastNetRecoveryAt = now;
  discoverServer();
}

// Parse "scheme://host:port/path" and TCP-probe it. Used to reject a URL
// saved in EEPROM when the laptop's DHCP address has changed.
static bool urlReachable(const char* url) {
  if (strstr(url, "vercel.app") != nullptr) return false;  // never use the cloud fallback
  const char* p = strstr(url, "://");
  if (p == nullptr) return false;
  p += 3;

  const char* slash = strchr(p, '/');
  const char* colon = strchr(p, ':');
  int port = 80;
  if (strncmp(url, "https", 5) == 0) port = 443;

  size_t hostLen = slash != nullptr ? static_cast<size_t>(slash - p) : strlen(p);
  if (colon != nullptr && (slash == nullptr || colon < slash)) {
    hostLen = static_cast<size_t>(colon - p);
    port = atoi(colon + 1);
  }
  if (hostLen == 0 || hostLen >= 64) return false;

  char host[64];
  memcpy(host, p, hostLen);
  host[hostLen] = '\0';

  WiFiClient probe;
  const bool ok = probe.connect(host, port, 1500);
  probe.stop();
  return ok;
}

// UDP broadcast discovery: tools/demo-runtime.mjs answers "CARESPEAK:<ip>".
// This survives DHCP changes and is much faster than scanning 254 addresses.
static bool udpDiscover() {
  WiFiUDP udp;
  if (!udp.begin(DISCOVERY_LOCAL_PORT)) {
    LOG("Server: UDP begin failed\n");
    return false;
  }

  IPAddress subnet = WiFi.localIP();
  subnet[3] = 255;
  const IPAddress global(255, 255, 255, 255);

  bool found = false;
  for (uint8_t attempt = 0; attempt < 3 && !found; ++attempt) {
    const char* probeMsg = "CARESPEAK?";
    udp.beginPacket(global, DISCOVERY_PORT);
    udp.write(reinterpret_cast<const uint8_t*>(probeMsg), 10);
    udp.endPacket();
    udp.beginPacket(subnet, DISCOVERY_PORT);
    udp.write(reinterpret_cast<const uint8_t*>(probeMsg), 10);
    udp.endPacket();

    const uint32_t start = millis();
    while (millis() - start < 1200) {
      loopHeartbeatMs = millis();
      const int len = udp.parsePacket();
      if (len <= 0) {
        delay(5);
        continue;
      }
      char buf[80];
      int n = udp.read(buf, sizeof(buf) - 1);
      if (n < 0) n = 0;
      buf[n] = '\0';
      if (strncmp(buf, "CARESPEAK:", 10) == 0) {
        String host = String(buf + 10);
        host.trim();
        if (host.length() > 0 && host.length() < 60) {
          snprintf(SERVER_URL, sizeof(SERVER_URL), "http://%s:3000/api/ingest", host.c_str());
          LOG("Server: UDP found %s\n", SERVER_URL);
          found = true;
          break;
        }
      }
    }
  }
  udp.stop();
  return found;
}

// Auto-discover the CareSpeak server on the local network.
static void discoverServer() {
  if (strlen(SERVER_URL_OVERRIDE) > 0) {
    strlcpy(SERVER_URL, SERVER_URL_OVERRIDE, sizeof(SERVER_URL));
    LOG("Server: using override URL %s\n", SERVER_URL);
    return;
  }

  // A URL saved on a previous network must be validated, otherwise the board
  // would keep posting to a dead address forever after the laptop's IP changes.
  if (strlen(SERVER_URL) > 0) {
    if (urlReachable(SERVER_URL)) return;
    LOG("Server: saved URL %s unreachable, clearing\n", SERVER_URL);
    SERVER_URL[0] = '\0';
  }

  if (WiFi.status() != WL_CONNECTED) return;

  LOG("Server: auto-discovering on local network...\n");
  if (loopWatchdog) esp_timer_stop(loopWatchdog);

  if (udpDiscover()) {
    saveServerUrl(SERVER_URL);
    if (loopWatchdog) esp_timer_start_periodic(loopWatchdog, 5000000ULL);
    return;
  }

  IPAddress ip = WiFi.localIP();
  WiFiClient probe;
  const uint8_t gw = WiFi.gatewayIP()[3];

  // The laptop is 192.168.0.144 on "Anas", but DHCP can move it. The gateway
  // is the laptop itself when the laptop hosts the hotspot (192.168.137.1).
  uint8_t candidates[] = { gw, 144, 137, 100, 101, 54, 2, 10, 50, 200, 254, 1 };
  const uint8_t candidateCount = sizeof(candidates) / sizeof(candidates[0]);
  for (uint8_t ci = 0; ci < candidateCount; ++ci) {
    loopHeartbeatMs = millis();
    IPAddress target(ip[0], ip[1], ip[2], candidates[ci]);
    if (target == ip) continue;
    LOG("  trying %s...\n", target.toString().c_str());
    if (probe.connect(target, 3000, 900)) {
      snprintf(SERVER_URL, sizeof(SERVER_URL), "http://%s:3000/api/ingest", target.toString().c_str());
      LOG("Server: discovered at %s\n", SERVER_URL);
      saveServerUrl(SERVER_URL);
      probe.stop();
      if (loopWatchdog) esp_timer_start_periodic(loopWatchdog, 5000000ULL);
      return;
    }
    probe.stop();
  }

  // Full subnet scan as the last resort (25 ms per address).
  LOG("Server: scanning subnet %s...\n", ip.toString().c_str());
  for (uint16_t i = 1; i <= 254; ++i) {
    loopHeartbeatMs = millis();
    IPAddress target(ip[0], ip[1], ip[2], static_cast<uint8_t>(i));
    if (target == ip) continue;
    bool skip = false;
    for (uint8_t ci = 0; ci < candidateCount; ++ci) {
      if (i == candidates[ci]) { skip = true; break; }
    }
    if (skip) continue;
    if (probe.connect(target, 3000, 25)) {
      snprintf(SERVER_URL, sizeof(SERVER_URL), "http://%s:3000/api/ingest", target.toString().c_str());
      LOG("Server: discovered at %s\n", SERVER_URL);
      saveServerUrl(SERVER_URL);
      probe.stop();
      if (loopWatchdog) esp_timer_start_periodic(loopWatchdog, 5000000ULL);
      return;
    }
  }

  // Never fall back to the cloud: it cannot store data without Redis quota.
  // Leaving the URL empty makes the scheduler retry discovery every 10 s, and
  // the USB serial bridge keeps the dashboard live in the meantime.
  LOG("Server: not found on this network; will retry in 10 s (USB bridge still live)\n");
  if (loopWatchdog) esp_timer_start_periodic(loopWatchdog, 5000000ULL);
}

static void wifiScheduleRetry(uint32_t now) {
  wifiState = WifiState::Idle;
  uint8_t shift = wifiBackoffStep > 3 ? 3 : wifiBackoffStep;
  uint32_t delayMs = 5000UL << shift;          // 5 s, 10 s, 20 s, 40 s
  if (wifiBackoffStep < 3) ++wifiBackoffStep;
  wifiNextAttemptAt = now + delayMs;
  LOG("Wi-Fi: retry in %lu s\n", static_cast<unsigned long>(delayMs / 1000));
}

static void wifiLoop(uint32_t now) {
  switch (wifiState) {
    case WifiState::Idle:
      if (!wifiManuallyDisabled && !wifiPausedForBt && timeReached(now, wifiNextAttemptAt)) wifiStart(now);
      break;

    case WifiState::Connecting:
      // wifiStart now connects synchronously; this state is kept for compatibility.
      if (WiFi.status() == WL_CONNECTED) {
        wifiState        = WifiState::Connected;
        wifiBackoffStep  = 0;
        LOG("Wi-Fi: connected, IP %s, RSSI %d dBm\n",
            WiFi.localIP().toString().c_str(), WiFi.RSSI());
        lastVitalsPost = now - POST_INTERVAL_MS + 1000UL;
        lastNetRecoveryAt = now;
        discoverServer();
      } else if (now - wifiStartedAt >= WIFI_CONNECT_TIMEOUT) {
        LOG("Wi-Fi: connect timeout (status %d)\n", WiFi.status());
        WiFi.disconnect(true, false);
        wifiScheduleRetry(now);
      }
      break;

    case WifiState::Connected:
      if (WiFi.status() != WL_CONNECTED) {
        LOG("Wi-Fi: link lost (status %d)\n", WiFi.status());
        wifiScheduleRetry(now);
      } else if (wifiManuallyDisabled) {
        WiFi.disconnect(true, false);
        WiFi.mode(WIFI_OFF);
        wifiState = WifiState::Idle;
      } else if (strlen(SERVER_URL) == 0) {
        // No server yet: retry discovery every 10 s.
        if (now - lastNetRecoveryAt >= 10000) {
          lastNetRecoveryAt = now;
          discoverServer();
        }
      } else if (lastPostTryAt != 0 && (now - lastPostOkAt) >= REDISCOVER_AFTER_MS) {
        // The laptop's IP may have changed. Re-probe the saved URL and
        // rediscover instead of waiting for a Wi-Fi reconnect.
        if (now - lastNetRecoveryAt >= REDISCOVER_AFTER_MS) {
          lastNetRecoveryAt = now;
          LOG("Net: no POST success for %lu s, rediscovering server\n",
              static_cast<unsigned long>((now - lastPostOkAt) / 1000));
          SERVER_URL[0] = '\0';
          discoverServer();
        }
      }

      // Last resort: if even discovery cannot produce a working POST for
      // 90 s, cycle the Wi-Fi link and rescan all networks.
      if (WiFi.status() == WL_CONNECTED && lastPostTryAt != 0 &&
          (now - lastPostOkAt) >= NET_RECOVERY_MS &&
          (now - lastWifiRecycleAt) >= NET_RECOVERY_MS) {
        lastWifiRecycleAt = now;
        LOG("Wi-Fi: no POST success for %lu s, forcing reconnect\n",
            static_cast<unsigned long>((now - lastPostOkAt) / 1000));
        WiFi.disconnect(true, false);
        wifiScheduleRetry(now);
      }
      break;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  6. MAX30102 — heart rate + SpO2
// ═════════════════════════════════════════════════════════════════════════════
static void spo2Reset() {
  spo2Index   = 0;
  spo2Count   = 0;
  spo2SumRed  = 0;
  spo2SumIr   = 0;
  spo2SumSqRed = 0;
  spo2SumSqIr  = 0;
  spo2Value   = 0;
}

static void spo2Add(float red, float ir) {
  if (spo2Count == SPO2_WINDOW) {
    // Drop the oldest sample from the running sums.
    spo2SumRed   -= spo2Red[spo2Index];
    spo2SumIr    -= spo2Ir[spo2Index];
    spo2SumSqRed -= spo2Red[spo2Index] * spo2Red[spo2Index];
    spo2SumSqIr  -= spo2Ir[spo2Index] * spo2Ir[spo2Index];
  } else {
    ++spo2Count;
  }
  spo2Red[spo2Index] = red;
  spo2Ir[spo2Index]  = ir;
  spo2SumRed   += red;
  spo2SumIr    += ir;
  spo2SumSqRed += red * red;
  spo2SumSqIr  += ir * ir;
  spo2Index = (spo2Index + 1) % SPO2_WINDOW;
}

static bool spo2Compute(int& out) {
  if (spo2Count < SPO2_WINDOW) return false;

  const double n     = static_cast<double>(SPO2_WINDOW);
  const double meanR = spo2SumRed / n;
  const double meanI = spo2SumIr / n;
  if (meanR < 1000.0 || meanI < 1000.0) return false;   // finger not covering

  const double varR = spo2SumSqRed / n - meanR * meanR;
  const double varI = spo2SumSqIr / n - meanI * meanI;
  if (varR <= 0.0 || varI <= 0.0) return false;

  const double acR = sqrt(varR);
  const double acI = sqrt(varI);
  if (acI < 20.0) return false;                  // too little pulsatile IR = noise

  const double ratio = (acR / meanR) / (acI / meanI);
  if (ratio < 0.25 || ratio > 1.60) return false; // outside any plausible pulse-ox range

  // MAX30102 empirical curve (Maxim application note). Demo-grade only,
  // not a medical device. Result is clamped to a sane display band.
  double value = -45.060 * ratio * ratio + 30.354 * ratio + 94.845;
  value = constrain(value, 70.0, 100.0);
  out = static_cast<int>(value + 0.5);
  return true;
}

static bool i2cPresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

static bool sensorBegin() {
  delay(500);  // let power rail settle after boot
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setTimeOut(100);            // never let a stuck I2C transaction block forever

  // Fast presence check: MAX30102 answers at 0x57. Without this, the
  // SparkFun begin() can spend seconds probing an empty bus.
  if (!i2cPresent(0x57)) {
    LOG("MAX30102: no I2C ACK at 0x57 — check 3V3, GND, SDA=21, SCL=22\n");
    return false;
  }

  // Cold-boot retry: a single failed begin() is usually a power/settling
  // hiccup, not a dead sensor.
  bool begun = false;
  for (uint8_t attempt = 0; attempt < 5 && !begun; ++attempt) {
    begun = particleSensor.begin(Wire, I2C_SPEED_STANDARD);
    if (!begun) {
      LOG("MAX30102: begin attempt %d failed, retrying...\n", attempt + 1);
      delay(200);
    }
  }
  if (!begun) {
    LOG("MAX30102: found at 0x57 but begin() failed — check power\n");
    return false;
  }

  // sampleAverage=4 (25 Hz effective), red+IR mode, 100 Hz, 411 us, 4096 nA.
  // 25 Hz is required by the vendor HR/SpO2 algorithm (100 samples = 4 s).
  particleSensor.setup(0x1F, 4, 2, 100, 411, 4096);
  particleSensor.setPulseAmplitudeRed(0x14);   // ~4 mA: keep IR DC in the 40-80k range
  particleSensor.setPulseAmplitudeIR(0x1A);    // ~5 mA: AC amplitude then stays inside
                                                  // the library's 20-1000 beat-detect band
  particleSensor.setPulseAmplitudeGreen(0);    // green not needed
  LOG("MAX30102: ready\n");
  return true;
}

static void sensorLoop(uint32_t now) {
  if (!sensorReady) {
    if (now - lastSensorAttempt >= SENSOR_RETRY_MS) {
      lastSensorAttempt = now;
      sensorReady = sensorBegin();
    }
    return;
  }

  // Sensor watchdog: if no valid IR reading for 30 s, re-initialise.
  // Protects against a stuck I2C bus after a power-rail sag on battery.
  static uint32_t lastGoodIrMs = 0;
  if (lastGoodIrMs == 0) lastGoodIrMs = now;

  if (!particleSensor.check()) return;

  const uint32_t red = particleSensor.getRed();
  const uint32_t ir  = particleSensor.getIR();

  if (ir > 100UL) lastGoodIrMs = now;
  if (now - lastGoodIrMs >= 30000UL) {
    LOG("Sensor: watchdog reset (no good IR for 30 s)\\n");
    sensorReady = false;
    lastSensorAttempt = now;
    lastGoodIrMs = now;
    return;
  }

#if DEBUG_SENSOR
  static uint32_t lastSensorLog = 0;
  if (now - lastSensorLog >= 1000UL) {
    lastSensorLog = now;
    LOG("raw: red=%lu ir=%lu bpm=%d spo2=%d\n",
        static_cast<unsigned long>(red), static_cast<unsigned long>(ir),
        beatAvg, spo2Value);
  }
#endif

  // Hysteresis: strong IR to acquire, much weaker to retain. Lowered
  // further for battery operation where the 3V3 rail may sag slightly.
  const bool present = fingerPresent ? (ir > 5000UL) : (ir > 10000UL);
  if (present != fingerPresent) {
    fingerPresent = present;
    LOG("Sensor: finger %s (ir=%lu)%s\n", present ? "detected" : "removed",
        static_cast<unsigned long>(ir),
        present ? (ir > 100000UL ? " (press LIGHTER)" : (ir < 20000UL ? " (press HARDER)" : "")) : "");
    if (!present) {
      fingerLostAt = now;
    } else {
      // Fresh contact: wipe old HR/SpO2 so stale values never follow the finger.
      fingerPresentSince = now;
      lastBeatMs         = now;
      beatAvg            = 0;
      rateCount          = 0;
      rateSpot           = 0;
      memset(rates, 0, sizeof(rates));
      spo2Reset();
      sensorCleared = false;
    }
  }

  if (!fingerPresent) {
    // Keep the HR/SpO2 window for 1.5 s so a brief lift does not wipe it.
    maximFilled = 0;
    maximPos = 0;
    maximHr = 0;
    maximSpo2 = 0;
    maximHrValid = 0;
    maximSpo2Valid = 0;
    if (!sensorCleared && now - fingerLostAt >= 1500UL) {
      beatAvg = 0;
      rateCount = 0;
      rateSpot = 0;
      memset(rates, 0, sizeof(rates));
      spo2Reset();
      sensorCleared = true;
    }
    return;
  }

  // Feed the vendor's 4-second / 25 Hz reference window.
  maximIr[maximPos] = ir;
  maximRed[maximPos] = red;
  maximPos = (maximPos + 1) % 100;
  if (maximFilled < 100) ++maximFilled;

  // Peak-to-peak tracker: helps tune finger pressure in the serial log.
  static uint32_t irMin = 0, irMax = 0;
  static uint8_t ppCount = 0;
  static uint32_t ppLastLog = 0;
  if (ppCount == 0) { irMin = ir; irMax = ir; }
  else { if (ir < irMin) irMin = ir; if (ir > irMax) irMax = ir; }
  ppCount++;
  if (ppCount >= 25) {                       // 1 s at 25 Hz
    uint32_t pp = irMax - irMin;
    if (now - ppLastLog >= 1000UL) {
      ppLastLog = now;
      LOG("HR: ir=%lu pp=%lu bpm=%d spo2=%d%s\n",
          static_cast<unsigned long>(ir), static_cast<unsigned long>(pp),
          beatAvg, spo2Value,
          pp < 30 ? " (press HARDER)" : (pp > 1000 ? " (press LIGHTER / relax)" : ""));
    }
    ppCount = 0;
    irMin = ir; irMax = ir;
  }

  // Vendor algorithm (Maxim REFDES117): robust HR + SpO2 from a 4 s window.
  if (maximFilled >= 100 && now - lastMaximCalc >= 1000UL) {
    lastMaximCalc = now;
    for (uint16_t i = 0; i < 100; ++i) {
      const uint16_t idx = (maximPos + i) % 100;
      maximIrCopy[i] = maximIr[idx];
      maximRedCopy[i] = maximRed[idx];
    }
    maxim_heart_rate_and_oxygen_saturation(
        maximIrCopy, 100, maximRedCopy,
        &maximSpo2, &maximSpo2Valid, &maximHr, &maximHrValid);
    LOG("MAXIM: hr=%ld (%d) spo2=%ld (%d)\n",
        static_cast<long>(maximHr), maximHrValid,
        static_cast<long>(maximSpo2), maximSpo2Valid);
    if (maximHrValid && maximHr >= 40 && maximHr <= 180) {
      beatAvg = static_cast<int>(maximHr);
    }
    if (maximSpo2Valid && maximSpo2 >= 70 && maximSpo2 <= 100) {
      spo2Value = static_cast<int>(maximSpo2);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  7. SOS BUTTON + BUZZER
// ═════════════════════════════════════════════════════════════════════════════
static void triggerSos(uint32_t now) {
  if (sosLatched) return;                        // one latched emergency per press
  sosLatched     = true;
  sosPending     = true;
  sosLatchedAt   = now;
  lastSosAttempt = now - SOS_RETRY_MS;           // dispatch on the next loop tick
  LOG("SOS: button pressed\n");
}

static void buttonLoop(uint32_t now) {
#if !ENABLE_SOS_BUTTON
  (void)now;
  return;   // no button wired: disable SOS entirely to avoid false triggers
#endif
  // Ignore button for the first 5 s after boot to avoid power-on noise
  // triggering a false SOS (especially on battery power).
  if (now < 5000UL) return;

  static bool lastReading = HIGH;
  static bool stable      = HIGH;
  static uint32_t lastChange = 0;

  const bool reading = digitalRead(PIN_SOS_BUTTON);
  if (reading != lastReading) {
    lastReading = reading;
    lastChange  = now;
  }
  if (now - lastChange >= SOS_DEBOUNCE_MS && stable != lastReading) {
    stable = lastReading;
    if (stable == LOW) triggerSos(now);
  }
}

static void buzzerLoop(uint32_t now) {
  if (!sosLatched || now - sosLatchedAt >= SOS_BUZZER_MS) {
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }
  const bool on = ((now - sosLatchedAt) / 250UL) % 2UL == 0;
  digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
}

static void sosLoop(uint32_t now) {
  if (sosLatched && now - sosLatchedAt >= SOS_LATCH_MS) {
    sosLatched = false;
    LOG("SOS: latch auto-cleared\n");
  }

  if (!sosPending) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (now - lastSosAttempt < SOS_RETRY_MS) return;

  lastSosAttempt = now;
  const int code = postEvent("sos");
  if (code >= 200 && code < 300) {
    sosPending = false;
    LOG("SOS: delivered\n");
  } else {
    LOG("SOS: delivery failed (%d), will retry\n", code);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  8. HTTP
// ═════════════════════════════════════════════════════════════════════════════
static int httpPost(const String& body, String* response = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  if (strlen(SERVER_URL) == 0) {
    static uint32_t lastNoUrlLog = 0;
    if (millis() - lastNoUrlLog >= 30000UL) {
      lastNoUrlLog = millis();
      LOG("HTTP: no server URL yet (USB bridge still receives data)\n");
    }
    return -1;
  }

  lastPostTryAt = millis();

  HTTPClient http;
  const bool secure = String(SERVER_URL).startsWith("https");

  // A plain http:// URL (the local dashboard) must NOT go through a TLS
  // client, and an https:// URL needs WiFiClientSecure. Keep both clients
  // static so heap isn't churned every 5 s.
  static WiFiClient       plainClient;
  static WiFiClientSecure secureClient;
  secureClient.setInsecure();                    // no RTC -> cannot pin a CA here

  WiFiClient* client = secure ? static_cast<WiFiClient*>(&secureClient)
                              : static_cast<WiFiClient*>(&plainClient);
  if (!http.begin(*client, SERVER_URL)) {
    LOG("HTTP: begin failed\n");
    client->stop();
    return -1;
  }
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);                          // fresh socket every packet
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_TOKEN) > 0) http.addHeader("x-device-token", DEVICE_TOKEN);

  const int code = http.POST(body);
  if (response != nullptr && code > 0) *response = http.getString();
  http.end();

  if (code >= 200 && code < 300) {
    lastPostOkAt   = millis();
    postFailStreak = 0;
  } else {
    if (postFailStreak < 255) ++postFailStreak;
    client->stop();                              // do not reuse a half-dead socket
    if (postFailStreak <= 5 || (postFailStreak % 10) == 0) {
      LOG("HTTP: POST failed (code %d, consecutive %u)\n", code, static_cast<unsigned>(postFailStreak));
    }
  }
  return code;
}

#if ENABLE_BATTERY
static int readBatteryPercent();   // defined in section 9
#endif

static int postVitals() {
  JsonDocument doc;
  doc["session"]  = SESSION_ID;
  doc["deviceId"] = DEVICE_ID;
  doc["type"]     = "vitals";

  if (beatAvg > 0) doc["heartRate"] = beatAvg;
  if (spo2Value > 0) doc["spo2"] = spo2Value;
  doc["finger"] = fingerPresent;
  doc["uptime"] = (millis() - bootAt) / 1000UL;

#if ENABLE_BATTERY
  const int battery = readBatteryPercent();
  if (battery >= 0) doc["batteryPct"] = battery;
#endif

  doc["sosActive"] = sosLatched;
  // Only report Wi-Fi RSSI when the radio is actually associated. Bluetooth-only
  // demo mode reports 0, which the dashboard would otherwise show as "Fair".
  if (WiFi.status() == WL_CONNECTED) doc["rssi"] = WiFi.RSSI();

  String body;
  body.reserve(224);
  serializeJson(doc, body);
  LOG("TX vitals: %s (heap=%lu)\n", body.c_str(),
      static_cast<unsigned long>(esp_get_free_heap_size()));
#if ENABLE_BT_SERIAL
  // Mirror the exact same line over Bluetooth Classic. The laptop bridge sees
  // it as a normal serial line on the paired virtual COM port.
  if (SerialBT.hasClient()) {
    SerialBT.printf("TX vitals: %s\n", body.c_str());
  }
#endif

  String response;
  const int code = httpPost(body, &response);
  LOG("POST vitals -> %d%s%s\n", code,
      (code == 200 || code == 201) ? "" : " ",
      (code == 200 || code == 201) ? "" : response.c_str());
  return code;
}

static int postEvent(const char* type) {
  JsonDocument doc;
  doc["session"]  = SESSION_ID;
  doc["deviceId"] = DEVICE_ID;
  doc["type"]     = type;

  String body;
  body.reserve(128);
  serializeJson(doc, body);
  LOG("TX %s: %s\n", type, body.c_str());
#if ENABLE_BT_SERIAL
  if (SerialBT.hasClient()) {
    SerialBT.printf("TX %s: %s\n", type, body.c_str());
  }
#endif

  String response;
  const int code = httpPost(body, &response);
  LOG("POST %s -> %d%s%s\n", type, code,
      (code == 200 || code == 201) ? "" : " ",
      (code == 200 || code == 201) ? "" : response.c_str());
  return code;
}

// ═════════════════════════════════════════════════════════════════════════════
//  9. BATTERY (optional)
// ═════════════════════════════════════════════════════════════════════════════
#if ENABLE_BATTERY
static int readBatteryPercent() {
  // 100k/100k divider halves the cell voltage. 3.0 V = 0 %, 4.2 V = 100 %.
  const uint32_t pinMv = analogReadMilliVolts(PIN_BATTERY);
  const uint32_t cellMv = pinMv * 2UL;
  if (cellMv < 3000UL) return -1;
  int pct = static_cast<int>((cellMv - 3000UL) * 100UL / 1200UL);
  return constrain(pct, 0, 100);
}
#endif

// ═════════════════════════════════════════════════════════════════════════════
// 10. VITALS SCHEDULER
// ═════════════════════════════════════════════════════════════════════════════
static void vitalsLoop(uint32_t now) {
  if (now - lastVitalsPost < POST_INTERVAL_MS) return;
  lastVitalsPost = now;
  // Always emit "TX vitals: {...}" on USB serial. Even with Wi-Fi completely
  // disabled, tools/serial-bridge.ps1 forwards this JSON to /api/ingest.
  postVitals();
}

// Last-resort recovery. The Wi-Fi state machine already forces a reconnect
// after 60 s without a successful POST; if that still fails, reboot cleanly.
static void networkHealthLoop(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (lastPostTryAt == 0) return;                // first packet not attempted yet
  if ((now - lastPostOkAt) >= REBOOT_AFTER_MS && postFailStreak >= 5) {
    hardRestart("no successful POST for 3 min");
  }
}

#if ENABLE_BT_SERIAL
// When the laptop opens the Bluetooth SPP port, drop Wi-Fi. This avoids
// Wi-Fi/BT radio contention, saves battery, and frees ~35 KB of heap. Wi-Fi
// comes back automatically a few seconds after the Bluetooth client leaves.
static bool btClientWasConnected = false;

static void btCoexistLoop(uint32_t now) {
  const bool client = SerialBT.hasClient();
  if (client && !btClientWasConnected) {
    btClientWasConnected = true;
    if (!wifiManuallyDisabled && !wifiPausedForBt) {
      wifiPausedForBt = true;
      LOG("BT: client connected -> Wi-Fi paused (direct Bluetooth mode)\n");
      WiFi.disconnect(true, false);
      WiFi.mode(WIFI_OFF);
      wifiState = WifiState::Idle;
    }
  } else if (!client && btClientWasConnected) {
    btClientWasConnected = false;
    if (wifiPausedForBt) {
      wifiPausedForBt = false;
      wifiState = WifiState::Idle;
      wifiNextAttemptAt = now + 3000;
      LOG("BT: client disconnected -> Wi-Fi resumes\n");
    }
  }
}
#endif

// ═════════════════════════════════════════════════════════════════════════════
// 11. SETUP / LOOP
// ═════════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(150);
  bootAt = millis();
  loopHeartbeatMs = bootAt;
  LOG("\nCareSpeak Wearable v%s\n", FW_VERSION);
  LOG("Reset reason: %d  (1=power-on, 9=brownout, 6=task WDT, 5=int WDT)\n",
      static_cast<int>(esp_reset_reason()));

  pinMode(PIN_SOS_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

#if ENABLE_BT_SERIAL
  // Bluetooth Classic SPP. Pair "CareSpeak-ESP32" once in Windows; it then
  // appears as a virtual COM port that the serial bridge can read.
  SerialBT.begin("CareSpeak-ESP32");
  LOG("Bluetooth: SPP started as \"CareSpeak-ESP32\"\n");
#endif

  configWarnings();
  loadServerUrl();
  LOG("Server: %s\n", strlen(SERVER_URL) > 0 ? SERVER_URL : "(auto-discover)");

  lastSensorAttempt = millis();
  sensorReady       = sensorBegin();

  startLoopWatchdog();

  // Wi-Fi starts from loop() so the rest of the system is live immediately.
  wifiState        = WifiState::Idle;
  wifiNextAttemptAt = millis();
}

void loop() {
  // Serial command handler: type "SETURL http://x.x.x.x:3000/api/ingest"
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.startsWith("SETURL ")) {
      String url = cmd.substring(7);
      url.trim();
      if (url.length() > 0 && url.length() < sizeof(SERVER_URL)) {
        strlcpy(SERVER_URL, url.c_str(), sizeof(SERVER_URL));
        saveServerUrl(SERVER_URL);
        LOG("Server: URL set to %s (saved)\n", SERVER_URL);
      }
    } else if (cmd == "STATUS") {
      LOG("Status: WiFi=%d IP=%s RSSI=%d Server=%s LastOK=%lu Heap=%lu\n",
          WiFi.status(), WiFi.localIP().toString().c_str(), WiFi.RSSI(), SERVER_URL,
          static_cast<unsigned long>(lastPostOkAt),
          static_cast<unsigned long>(esp_get_free_heap_size()));
    } else if (cmd == "WIFIOFF") {
      wifiManuallyDisabled = true;
      WiFi.disconnect(true, false);
      WiFi.mode(WIFI_OFF);
      wifiState = WifiState::Idle;
      LOG("Wi-Fi: OFF (USB bridge only). Send WIFION to re-enable.\n");
    } else if (cmd == "WIFION") {
      wifiManuallyDisabled = false;
      wifiState = WifiState::Idle;
      wifiNextAttemptAt = millis();
      LOG("Wi-Fi: ON, connecting...\n");
    } else if (cmd == "CLEARURL") {
      SERVER_URL[0] = '\0';
      saveServerUrl("");
      LOG("Server: URL cleared; will rediscover\n");
    } else if (cmd == "REBOOT") {
      ESP.restart();
    }
  }

  const uint32_t now = millis();
  loopHeartbeatMs = now;

  // Network work runs FIRST: even if the sensor I2C bus locks up later in
  // this iteration, the watchdog restarts the board within 45 s.
#if ENABLE_BT_SERIAL
  btCoexistLoop(now);
#endif
  wifiLoop(now);
  vitalsLoop(now);
  networkHealthLoop(now);
  sosLoop(now);
  buttonLoop(now);
  buzzerLoop(now);
  sensorLoop(now);

  delay(2);   // yield to the IDLE task; keeps loop() fast and responsive
}
