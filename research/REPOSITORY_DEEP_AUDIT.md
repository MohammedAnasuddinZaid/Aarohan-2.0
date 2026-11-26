# CareSpeak — Deep Audit (per subsystem)

**Audit date:** 2026-11-24 · **HEAD:** `1b2940c`
Companion to `COMPLETE_REPOSITORY_AUDIT.md` (the inventory). This file is the
*findings* list. Every finding names the file it was read from. Security items in
full are in `SECURITY_REVIEW.md`; this file links to them rather than repeating.

Status legend: **FIXED** (code changed this pass), **OPEN** (known, not fixed),
**VERIFIED-OK** (checked, no defect), **UNVERIFIED** (could not test here).

---

## A. Retrieval, routing and answer safety

- **R-1 · Synonym expansion crossed clinical categories — FIXED.**
  `src/lib/care/retrieval.ts` expanded `water → furosemide/diuretic/swelling`,
  `thin → warfarin/apixaban/rivaroxaban`, `antibiotic → infection`,
  `sugar → blood`. A question about drinking water could rank a diuretic passage;
  a *medicine* query could match a *diagnosis* passage. Remediated by removing the
  cross-category links while keeping medicine↔medicine links; pinned by
  `tests/retrieval-synonym-safety.test.ts`.
- **R-2 · Retrieval gate — VERIFIED-OK.** `npm run eval:rag` →
  `recall@5=0.957 MRR=0.891`, 22/23, `>= 0.90` gate green, no negative case
  reports a `strong` match (`tests/rag-eval.test.ts`).
- **R-3 · Emergency short-circuit precedes the cache — VERIFIED-OK.** Emergency
  scope answers are produced by rules before the answer cache and are never
  cached (`src/lib/care/portalBrain.ts`, `route.scope === "emergency"` branch).
- **R-4 · Answer cache is patient-scoped and versioned — VERIFIED-OK.**
  `cacheKey()` hashes session/patient/model/version inputs
  (`portalBrain.ts` `cacheKey`/`cacheGet`/`cachePut`); no cross-patient reuse.
  No competing cache was added in this pass.

## B. Progressive web app / service worker

- **B-1 · Clinical pages must never be cached — VERIFIED-OK (pinned).**
  `public/sw.js` is `carespeak-v3`; `PRIVATE_PREFIXES` contains `/api/`, `/care`,
  `/nurse-view`, `/ward`, `/dashboard`, `/logs`, `/report`, `/cctv`; `SHELL`
  precaches only public pages. `tests/service-worker-privacy.test.ts` reads the
  shipped file and asserts each rule, so the guard cannot silently regress.

## C. Speech (browser)

- **C-1 · Remote TTS is opt-in — VERIFIED-OK.** `src/lib/tts.ts` only calls
  `translate_tts` when `NEXT_PUBLIC_CARE_REMOTE_TTS === "1"`; otherwise a missing
  local voice falls back to English rather than leaking text.
- **C-2 · Bounded queue drops the oldest utterance — OPEN (documented).**
  `doSpeak()` does `if (queue.length >= MAX_QUEUE) queue.shift()` (MAX_QUEUE = 4).
  Under a burst a queued phrase can be discarded silently. Low impact (the newest
  intent wins) but worth a "dropped" signal; not changed to avoid altering the
  single-flight semantics without measurement.

## D. Accessibility

- **D-1 · Alternative input to camera — IMPLEMENTED.** New
  `src/components/QuickPhrases.tsx` gives a keyboard/switch-accessible AAC phrase
  grid, wired into `hand-mode` and `eye-mode` beside (never replacing) the gesture
  UI. Non-gesture phrases are English-only and are visibly labelled `EN` rather
  than showing an unverified translation.
- **D-2 · Gesture result announced — VERIFIED-OK.** Result cards carry
  `role="status" aria-live="polite"` (hand/eye mode).

## E. Security and authorisation

Full detail in `SECURITY_REVIEW.md`. Summary of items still **OPEN**:

- **E-1** `/api/notify` escalation dispatch is unauthenticated in demo mode.
- **E-2** A bare session id is a capability on `/api/sync` and `/api/stream`
  for sessions that have not registered a pair token.
- **E-3** `/api/ward` exposes every active session's data in demo mode.
- **E-4** `/api/ingest` accepts unauthenticated posts when no device token is set.
- **E-5** `/api/pair` registration is unauthenticated and first-writer-wins.

**Mitigation shipped this pass:** `src/lib/care/securityMode.ts` now returns
`strict` by default when the app runs hosted (`VERCEL` set), so a public
deployment is closed unless it *explicitly* sets `CARE_SECURITY_MODE=demo`.
Verified by `tests/security-mode.test.ts`.

## F. Backend (VoiceLink)

- **F-1 · Backend suite — VERIFIED-OK.** 534 tests pass (`pytest -q`).
- **F-2 · Telephony outbound paths — UNVERIFIED.** No Twilio/Exotel credentials
  here; `backend/app/telephony/*` runs only against mocks in tests.
- **F-3 · Real ASR/TTS latency — UNVERIFIED.** No GPU/audio hardware; existing
  numbers in `PERFORMANCE_REPORT.md` are reproduced as historical in
  `SPEECH_LATENCY_OPTIMIZATION.md`.

## G. Firmware

- **G-1 · Device auth is optional-by-design — OPEN (consistent with ingest).**
  `firmware/carespeak_esp32.ino` sends `x-device-token` only if `DEVICE_TOKEN` is
  non-empty, mirroring the server's optional device token. In strict mode the
  server refuses tokenless ingest, so the firmware must be flashed with a token
  for a real deployment.
- **G-2 · SOS retry — VERIFIED-OK.** An undelivered emergency arms a 4 s retry
  loop rather than being dropped (`SOS_RETRY_MS`, `loop()`).

## H. Tests and CI

- **H-1 · CI added — IMPLEMENTED.** `.github/workflows/ci.yml` runs, on push/PR:
  `typecheck`, `vitest`, `rag-eval`, `next build` (frontend job) and
  `pip install -r requirements.txt` + `pytest` (backend job), plus a non-blocking
  `npm audit` advisory job. Least-privilege `contents: read`.
- **H-2 · Pre-existing typecheck error — FIXED.** `tests/care-routes.test.ts`
  called `getNetworkInfo()` with no argument after the route gained a
  `NextRequest` parameter; `tsc --noEmit` failed. Now passes a request.
- **H-3 · Backend deps install without GPU or model files — VERIFIED-OK.**
  `sherpa-onnx`/`onnxruntime` use manylinux wheels and the tests stub the engines,
  so the backend CI job needs neither GPU nor models.

## I. Dependencies

- **I-1 · Production advisories reduced — FIXED.** `npm audit` 9 → 5 via `npm audit
  fix`; `next` 15.5.20 → 15.5.29. Remaining: dev-only vitest/vite/tinypool
  toolchain and one moderate advisory via Next's bundled `postcss@8.4.31`
  (fix requires a Next 16 major upgrade). See `INSTALLATION_AND_DEPENDENCY_REPORT.md`.
