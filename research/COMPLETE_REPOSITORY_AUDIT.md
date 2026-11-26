# CareSpeak — Complete Repository Audit

**Audit date:** 2026-11-24
**Repository (origin):** `https://github.com/MohammedAnasuddinZaid/Aarohan-2.0.git`
**HEAD audited:** `1b2940c` (on `main`, local; pushed state verified separately)
**Method:** direct source inspection + executed commands, not README reading. Every
number below was produced by a command run in this working tree.

This document is the *inventory*. The per-subsystem findings are in
`REPOSITORY_DEEP_AUDIT.md`; the previous passes are in `00_EXECUTIVE_SUMMARY.md`,
`TECHNICAL_ARCHITECTURE_AUDIT.md`, `FINAL_ENGINEERING_AUDIT.md` and
`SECURITY_PRIVACY_AUDIT.md`.

---

## 1. What the thing actually is

| Layer | Technology | Location | Verified how |
|---|---|---|---|
| Patient app (PWA) | Next.js 15 / React 19 / TypeScript, Tailwind 4 | `src/app/*`, `src/components/*` | `npm run build` |
| On-device CV | MediaPipe `@mediapipe/tasks-vision` (WASM), hand + face/eye | `src/hooks/useHandGesture.ts`, `useEyeGesture.ts`, `src/lib/visionPreload.ts` | source read |
| Speech (browser) | Web Speech Synthesis, single-flight queue | `src/lib/tts.ts` | source read |
| Retrieval / QA | MiniSearch lexical retrieval + deterministic rules + optional Gemini | `src/lib/care/*` | `npm run eval:rag` |
| State | Upstash Redis, else file, else memory | `src/lib/care/store.ts`, `src/lib/server/store.ts` | `/api/health`, source |
| Voice backend | FastAPI + sherpa-onnx (ASR/TTS) + Ollama | `backend/app/*` | `pytest` |
| Telephony | Twilio / Exotel adapters | `backend/app/telephony/*` | source read |
| Device | ESP32 firmware → `/api/ingest` | `firmware/carespeak_esp32.ino` | source read |

No framework was replaced and no competing service was added in this pass.

## 2. Size (measured)

| Metric | Value | Command |
|---|---|---|
| TypeScript/TSX files (`src/`) | 153 | `Get-ChildItem src -Recurse -Include *.ts,*.tsx` |
| TypeScript/TSX lines (`src/`) | 34,589 | line count |
| Python files (`backend/app/`) | 31 | `Get-ChildItem backend/app -Recurse -Filter *.py` |
| Python lines (`backend/app/`) | 9,615 | line count |
| Frontend test files | 52 | `Get-ChildItem tests -File` |
| Frontend tests passing | 817 | `npx vitest run` |
| Backend tests passing | 534 | `python -m pytest -q` (in `backend/.venv`) |
| Next.js API route handlers | 35 | `Get-ChildItem src/app/api -Recurse -Filter route.ts` |
| Backend route handlers | 46 | grep `@app|@router` in `main.py` + `platform_api.py` |

## 3. Frontend API surface and its gate (verified)

Gate legend: **N** = nurse cookie, **P** = pair token, **D** = device token,
**S** = only enforced in `strict` mode, **open** = unauthenticated in `demo`.

| Route | Gate (demo) | Gate (strict) |
|---|---|---|
| `api/health` | open (no secrets, posture only) | open |
| `api/network-info` | open (private IPv4 only; `VERCEL` → empty) | N |
| `api/pair` | open (token registration) | open |
| `api/sync` GET/POST | session id (until the bed is paired) | N or P |
| `api/stream` | session id | N or P |
| `api/ward` | **open** | N |
| `api/notify` | **open** | N |
| `api/ingest` | **open** when no device token set | D |
| `api/care/auth/login` | demo creds `nurse.demo/nurse.demo` | real creds only |
| `api/care/*` | N | N |
| `api/care/phone/qr` | N or P | N or P |

**The single most important consequence:** on a *hosted* deployment these open
rows are reachable by anyone. That is why, in this pass, a hosted deployment
(`VERCEL` set) now defaults to **strict** — see `SECURITY_REVIEW.md` §"hosted default".

## 4. Documented vs actual (discrepancies found and their status)

| Claim | Reality found in code | Status |
|---|---|---|
| "10 Indian languages" | 9 Indic languages + English = 10 codes; UI strings exist for all 10 | accurate as codes; TTS voice availability is machine-dependent |
| "100% on-device AI" | Server-side Gemini (optional) + opt-in remote TTS exist | opt-in only; README already qualified |
| "session-scoped data isolation" | sync/ward/notify/ingest were open in demo | **improved:** hosted default is now strict; open rows remain only in explicit demo |
| RAG eval "0.957/0.891" | true for the committed table; a mid-session draft read 0.870 | gate is green at 0.957/0.891 now; `RAG_CAG_ARCHITECTURE.md` corrected |
| Service worker caches clinical pages | v2 did; v3 does not | fixed in the prior pass; pinned by `tests/service-worker-privacy.test.ts` |

## 5. What this audit could NOT verify (blocked in this environment)

- **No Vercel deploy** was performed (no credentials/CLI auth) — deployment is
  documented, not executed. See `docs/VERCEL_PRODUCTION_DEPLOYMENT.md`.
- **No GPU, camera, microphone or phone hardware** — no real ASR/TTS latency or
  CV-accuracy number could be measured. All such figures are labelled `UNVERIFIED`.
- **No Redis / Twilio / Gemini / MSG91 / Exotel credentials and no real patient
  data** — multi-instance sync, real outbound calls and SMS remain `UNVERIFIED`.
- **No external penetration test** — `SECURITY_REVIEW.md` is a source review, not
  a pentest, and asserts no HIPAA/GDPR/DPDP compliance.

## 6. Reproduce this audit

```powershell
# frontend
npm ci
npm run typecheck
npm test
npm run eval:rag
npm run build
# backend
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

All commands above were executed and passed at HEAD `1b2940c`.
