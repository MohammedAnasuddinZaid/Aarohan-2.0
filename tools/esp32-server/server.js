// CareSpeak ESP32 Vitals Server — standalone local dashboard
// Run: node server.js
// Then open http://localhost:3000 in your browser
// Update ESP32 SERVER_URL to http://<your-pc-ip>:3000/api/ingest

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

// ── CareSpeak forwarding ──────────────────────────────────────────────────
// Every packet the ESP32 sends here is also mirrored to the deployed app,
// so the local dashboard and CareSpeak stay in sync from day one.
const CARESPEAK_URL =
  "https://carespeak-artificial.vercel.app/api/ingest";
const DEVICE_TOKEN =
  "937a7b8ba22a6b61643d506fa534452e8b2f2309443bc1c4acaed1692d51f396";
const FORWARD_TO_CARESPEAK = true;

async function forwardToCareSpeak(payload) {
  if (!FORWARD_TO_CARESPEAK) return;
  try {
    const res = await fetch(CARESPEAK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-device-token": DEVICE_TOKEN,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text().catch(() => "");
    console.log(`   ↳ CareSpeak ${res.status}${text ? " " + text.slice(0, 120) : ""}`);
  } catch (e) {
    console.log(`   ↳ CareSpeak forward failed: ${e.message}`);
  }
}

let vitals = null;
let sosAlerts = [];
let lastUpdate = 0;
let lastPacketAt = 0;
let deviceWasOnline = false;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-token");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // POST /api/ingest — receive ESP32 data
  if (url.pathname === "/api/ingest" && req.method === "POST") {
    res.setHeader("Connection", "close");   // ESP32 opens a fresh socket every time
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (!data || typeof data !== "object" ||
            !data.session || !data.deviceId ||
            !["vitals", "sos"].includes(data.type)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid packet" }));
          return;
        }

        console.log(`[${new Date().toLocaleTimeString()}] Received:`, JSON.stringify(data));
        lastPacketAt = Date.now();

        if (data.type === "sos") {
          sosAlerts.unshift({ timestamp: Date.now(), deviceId: data.deviceId, session: data.session });
          sosAlerts = sosAlerts.slice(0, 20);
          console.log("🚨 SOS ALERT received!");
        } else if (data.type === "vitals") {
          vitals = { ...data, receivedAt: Date.now() };
          lastUpdate = lastPacketAt;
        }

        // Mirror to CareSpeak (fire-and-forget so the ESP32 gets a fast 200).
        // Throttle to every 6th packet (~30 s) to stay under the Upstash
        // free-tier monthly request quota while keeping CareSpeak in sync.
        if (!globalThis.__csForwardCounter) globalThis.__csForwardCounter = 0;
        globalThis.__csForwardCounter++;
        if (globalThis.__csForwardCounter % 6 === 0 || data.type === "sos") {
          forwardToCareSpeak(data);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, serverTime: Date.now() }));
      } catch (e) {
        console.error("Parse error:", e.message);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
      }
    });
    return;
  }

  // GET /api/vitals — return latest vitals
  if (url.pathname === "/api/vitals" && req.method === "GET") {
    const now = Date.now();
    const deviceOnline = lastPacketAt > 0 && (now - lastPacketAt) <= 15000;
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    });
    res.end(JSON.stringify({
      vitals,
      sosAlerts,
      lastUpdate,
      lastPacketAt,
      deviceOnline,
      serverTime: now,
      ok: true,
    }));
    return;
  }

  // GET / — serve dashboard
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const htmlPath = path.join(__dirname, "dashboard.html");
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
      });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end("dashboard.html not found");
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   CareSpeak ESP32 Vitals Dashboard Server        ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║   Dashboard:  http://localhost:${PORT}               ║`);
  console.log(`║   Ingest:     http://localhost:${PORT}/api/ingest    ║`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║   Update ESP32 SERVER_URL to:                    ║");
  console.log(`║   http://<your-pc-ip>:${PORT}/api/ingest            ║`);
  console.log("║   Find your PC IP: ipconfig (Windows)            ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");
});

// Warn clearly when the ESP32 goes silent. This is what freezes a dashboard
// that only trusts the last stored value.
setInterval(() => {
  if (lastPacketAt === 0) return;
  const age = Date.now() - lastPacketAt;
  const online = age <= 15000;
  if (deviceWasOnline && !online) {
    console.log(`⚠ Device OFFLINE — no packet for ${Math.round(age / 1000)} s`);
  } else if (!deviceWasOnline && online) {
    console.log("✓ Device back online");
  }
  deviceWasOnline = online;
}, 5000);
