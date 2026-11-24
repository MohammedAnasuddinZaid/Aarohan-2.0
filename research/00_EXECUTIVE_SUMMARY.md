# CareSpeak — Executive Summary & Audit Snapshot

**Audit date:** 2026-11-24 (local session)
**Repository:** `https://github.com/MohammedAnasuddinZaid/Aarohan-2.0.git`
**Base commit (cutoff):** `136c7f92d41cae82a6d2da8a502bbb6f7aec4059` (the only history that should ship)
**Current working tree:** clean after this pass; see `IMPLEMENTATION_PROGRESS.md`

## What CareSpeak is (verified from code)

A Next.js 15 / React 19 / TypeScript PWA that turns hand gestures and eye
movements into speech and streams alerts to a clinician dashboard. It also
contains an optional Python "VoiceLink" backend (FastAPI + Whisper + Ollama)
for a browser voice call, and a WebRTC care-call UI. Detection runs on-device
via MediaPipe WASM; session state is persisted through Upstash Redis or a
memory/file fallback.

## Verified engineering state at this pass

- **Tests:** 766 passing (45 files) — 12 new tests added this pass.
- **Build:** `npm run build` succeeds (Next.js 15 production build).
- **Live deployments:** `care-speak.vercel.app` and `carepeakai.vercel.app` both
  answer; the two differ in navigation (carepeakai exposes Care/Records + a
  VoiceLink band that care-speak's nav omits). Treat neither as the source of
  truth; the repository is.
- **Storage driver:** `redis` only when `UPSTASH_REDIS_REST_URL/TOKEN` are set;
  otherwise `memory` on Vercel (single-instance, NOT cross-device). `/api/health`
  reports this honestly.

## Top risks (verified, not speculative)

1. **Unauthenticated realtime read/write** — `/api/sync` and `/api/stream`
   previously accepted a bare session id, so anyone who guessed or observed a
   6-character session id could read alerts, vitals and nurse replies and
   inject gestures. **Partially fixed this pass:** a bed that has registered a
   QR pairing token now requires it (or a nurse cookie); unpaired demo consoles
   still work. Residual bypass: an attacker can register first on an unpaired
   session. See `SECURITY_PRIVACY_AUDIT.md`.
2. **Unauthenticated escalation dispatcher** — `/api/notify` can trigger SMS/
   WhatsApp messages with only a valid-looking session id. **Documented, not yet
   fixed.**
3. **Unauthenticated ward overview** — `/api/ward` returns every active
   session's vitals and alerts. **Documented, not yet fixed.**
4. **Default demo credentials** — `nurse.demo / nurse.demo` unless env vars
   are set. **Rate-limited this pass; still demo by default.**
5. **PHI leak via remote TTS** — patient text was sent to an undocumented
   Google endpoint. **Fixed this pass:** off by default, opt-in env flag.
6. **Accessibility** — no skip link, missing labels/expanded state, no
   reduced-motion handling. **Fixed this pass** (skip link, focus-visible,
   reduced motion, ARIA labels/expanded/current).
7. **Truthfulness of README claims** — "10 Indian languages" (9 listed + English),
   "100% on-device AI" (server Gemini + remote TTS existed), "Security:
   session-scoped data isolation" (sync/ward/notify were open). Corrected in
   docs; README not rewritten to avoid breaking tests.

## What this pass changed

See `IMPLEMENTATION_PROGRESS.md`. Net: +12 tests (754 → 766), build still green.

## What is deliberately left for a larger implementation pass

- Strict-mode gating for demo endpoints (`/api/ward`, `/api/notify`,
  `/api/ingest`, `/api/network-info`) behind an explicit env flag.
- A server-side registration secret so sync auth cannot be pre-registered by an
  attacker.
- Caching layer for RAG/CAG, eval harness, and speech latency benchmarks.
- Real clinical accuracy validation (requires hardware + clinician review) —
  currently **UNVERIFIED**.
- Full WCAG 2.2 AA pass beyond the P1 fixes above.
- README claim corrections and a real deployment runbook.

Every unverified claim in this repository is labelled `UNVERIFIED` in the
research documents rather than presented as fact.