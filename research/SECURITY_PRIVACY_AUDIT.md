# Security & Privacy Audit — CareSpeak

## Fixed this pass

1. **Sync/stream read/write now require a registered QR pair token** (or nurse
   cookie) for beds that have registered one. Unpaired demo consoles remain
   open so emergency/CCTV flows are not broken. Files: `src/app/api/sync/route.ts`,
   `src/app/api/stream/route.ts`, `src/lib/care/sessionAccess.ts`,
   `src/lib/networkSync.ts`, `src/hooks/useLiveSync.ts`, `src/lib/pairing.ts`.
2. **Login throttling** — 5 attempts / 15 minutes per (IP, username), stored as
   a hashed key. Files: `src/lib/care/loginRateLimit.ts`,
   `src/app/api/care/auth/login/route.ts`.
3. **Remote TTS privacy leak** — Google translate_tts fallback is now off by
   default; opt-in via `NEXT_PUBLIC_CARE_REMOTE_TTS=1`. File: `src/lib/tts.ts`.

## Open P0 issues (not fixed — require a larger pass)

1. **`/api/ward` is unauthenticated.** Returns every active session's alerts,
   vitals, alertness, pairing IP/device. Fix: require nurse cookie; ward page
   must redirect to login when absent. Risk: ward demo breaks; document as
   breaking change.
2. **`/api/notify` is unauthenticated.** Can trigger real SMS/WhatsApp to up
   to 5 contacts per session/gesture (2-min throttle). Fix: require nurse
   cookie or pair token + server-side contact allow-list.
3. **`/api/ingest` runs in demo mode when `CARESPEAK_DEVICE_TOKEN` is unset.**
   Anyone can inject vitals or SOS events for any session. Fix: refuse ingest
   in production unless token set; keep demo mode only when
   `CARE_DEMO_MODE=1`.
4. **`/api/pair` registration is unauthenticated.** An attacker can register a
   pair token for an unpaired session before the console does, then read its
   data. Fix: require a server-issued session secret at registration.
5. **Default demo credentials** (`nurse.demo / nurse.demo`) are active unless
   env vars are set. Rate-limited only. Fix: refuse default creds in production
   unless `CARE_DEMO_MODE=1`.
6. **`/api/network-info` leaks LAN interface IPs** to any caller. Low severity
   but should be nurse-only or removed in production.
7. **Session ids are 6 characters** (~30 bits). Acceptable for a demo; not
   for a regulated deployment. Fix: 128-bit tokens or server-issued IDs.
8. **No CSRF token** on state-changing endpoints; mitigated by SameSite=Lax
   cookies and JSON content type. Document as residual.
9. **No audit of data retention / deletion.** Sessions and audit logs accumulate
   indefinitely in Redis. Add TTLs and a deletion path for GDPR/DPDP compliance.
10. **Gemini receives record context** (server-side, optional). Documented but
    no DPIA or data-processing agreement. Treat as PHI egress.

## Privacy of third-party endpoints

- Google translate_tts (now opt-in only) received spoken text including nurse
  replies. Do not enable without a DPIA.
- Gemini (optional) receives the nurse's question plus record context. Do not
  enable for real patients without a data-processing agreement.
- Twilio (optional) receives alert text and phone numbers. Already gated by
  credentials.

## Verified controls (real, not aspirational)

- Signed-cookie nurse sessions with 8h TTL; constant-time password compare.
- Per-bed QR pair tokens (32 hex) persisted in Redis; scan log requires token.
- `CARESPEAK_DEVICE_TOKEN` optional device auth on ingest.
- Input sanitization and clinical-range clamping on vitals/metrics.
- NaN rejection on alertness score.
- Formula-injection-safe CSV export (claimed; verify in code before trusting).
- CSP + hardened headers (claimed in README; verify `next.config`).

## Recommended security model

Introduce `CARE_SECURITY_MODE=demo|strict`. In strict mode: default creds
refused, demo endpoints require auth, ingest requires token, network-info
disabled. Default to `demo` for backwards compatibility; document that
production deployments must set `strict`. A larger pass should flip the default
to strict once all clients send pair tokens.