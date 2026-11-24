# Product Audit — CareSpeak

## 1. Feature inventory (verified against routes and code)

| Route / API | Purpose | Auth (before this pass) | Notes |
|---|---|---|---|
| `/`, `/about`, `/privacy`, `/terms`, `/license` | Marketing / legal | Public | Static content |
| `/hand-mode`, `/eye-mode` | Patient gesture console (MediaPipe WASM) | None (patient device) | Camera stays local |
| `/emergency` | One-tap emergency | None | Broadcasts to session |
| `/nurse-view` | Clinician console | Nurse cookie OR QR pair token | Live sync, replies, charts |
| `/ward` | Multi-patient overview | None (reads `/api/ward`) | **P0 privacy** |
| `/cctv` | Remote camera detection | None | Writes to session |
| `/logs`, `/report` | History, analytics, export | Nurse cookie (records) | CSV/JSON export |
| `/care/records`, `/care`, `/care/join`, `/care/phone` | Patient records + AI assistant + WebRTC call | Nurse cookie / session | Records are nurse-scoped |
| `/voicelink` | Browser voice call (WebSocket) | None (demo) | Requires local backend |
| `/api/sync`, `/api/stream` | Realtime data plane | **None (P0)** → pair-gated for registered beds | See SECURITY audit |
| `/api/notify` | SMS/WhatsApp escalation | None | **P0 cost/abuse** |
| `/api/ingest` | ESP32 vitals/SOS | Optional device token (demo-open) | Demo mode default |
| `/api/health` | Diagnostics | Public | Reports driver + commit |
| `/api/pair`, `/api/ward`, `/api/network-info` | Pairing / ward / LAN discovery | Mixed | See security audit |

## 2. Claim vs. reality (README)

| README claim | Reality | Verdict |
|---|---|---|
| "10 Indian languages" | 9 Indian + English (hi, bn, ta, te, mr, gu, kn, ml, pa) | Overstated by one |
| "100% on-device AI" | Server-side Gemini (`GEMINI_API_KEY`), remote Google TTS fallback, optional browser AI | Overstated |
| "Security: session-scoped data isolation" | `/api/sync`, `/api/stream`, `/api/ward`, `/api/notify` were open | Overstated |
| "Accessibility: aria-live, keyboard-friendly nav" | No skip link, no reduced-motion, unlabeled controls | Partial |
| "Unit tests for classifiers, risk engine, Shapley invariant" | True — 766 tests pass | Verified |
| "Offline-first: IndexedDB outbox + Background Sync" | True (`src/lib/outbox.ts`, `networkSync.ts`) | Verified |
| "Unique per-bed QR with scan tracking" | True (`src/lib/server/pairing.ts`) | Verified |
| "ESP32 wearable $11" | Hardware BOM not verifiable in this repo | UNVERIFIED |
| "Shapley attribution exact" | Claimed exact; tests assert invariant | Verified by tests, not by an independent reference |
| "NEWS2 / NICE CG50 citations" | Curated corpus; accuracy not clinically validated | UNVERIFIED clinically |

## 3. Authentication model (verified)

- Nurse: signed-cookie session stored in the shared driver (`care:login:<hash>`),
  8-hour TTL, optional admin account. Default `nurse.demo / nurse.demo`.
- Patient/console: 6-char session id + optional per-bed QR pair token (32 hex).
- Device: optional `CARESPEAK_DEVICE_TOKEN` header for `/api/ingest`.
- **No middleware file exists** in the repo; guards are per-route.

## 4. Data and privacy

- Session state (alerts, metrics, vitals, replies) is stored in Redis/memory/file.
- Pairing scan log stores IP + user-agent of scanning devices (24h TTL).
- Audit log stores login events and assistant actions.
- Remote TTS previously sent spoken text to Google (fixed: off by default).
- Gemini sends prompt + record context to Google when configured (documented,
  server-side only, optional).

## 5. Known product limitations (honest)

- No real patient data; demo seed creates synthetic patients.
- No clinically validated outcomes; risk scoring is a heuristic, not a device.
- No FDA/CE/MDR certification; do not use for medical decisions.
- VoiceLink backend is local-only (Whisper/Ollama) and not deployed with the
  frontend.
- Multi-device sync requires Redis; without it the UI honestly reports
  `memory` driver.