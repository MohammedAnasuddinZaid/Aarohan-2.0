# Implementation Progress — This Pass

## Code changes

### Security
- `src/lib/care/sessionAccess.ts` — added `authorizeSyncSession` + caches +
  `resetSessionAccessForTests`.
- `src/app/api/sync/route.ts` — pair-gated GET and POST.
- `src/app/api/stream/route.ts` — pair-gated SSE.
- `src/lib/pairing.ts` — added `peekPairToken`.
- `src/hooks/useLiveSync.ts` — passes pair token from storage.
- `src/lib/networkSync.ts` — carries pair on SSE URL, poll URL, POST body.
- `src/lib/care/loginRateLimit.ts` — new throttling module.
- `src/app/api/care/auth/login/route.ts` — throttle before credential check.
- `src/lib/care/store.ts` — added `loginRate` key.

### Privacy
- `src/lib/tts.ts` — remote Google TTS off by default (opt-in env).
- `.env.example` — documented `NEXT_PUBLIC_CARE_REMOTE_TTS`.

### Accessibility
- `src/app/layout.tsx` — skip link + main landmark id/tabIndex.
- `src/app/globals.css` — focus-visible, skip-link, reduced-motion.
- `src/components/Navbar.tsx` — ARIA labels/expanded/controls/current.

## Tests

- Added `tests/login-rate-limit.test.ts` (7 tests).
- Extended `tests/care-access.test.ts` (+3 sync auth tests).
- Extended `tests/network-sync.test.ts` (+1 pair-carrying test).
- Extended `tests/frontend-tts.test.ts` (+1 privacy test, env opt-in on 2).
- Total: 754 → 766 passing.

## Verification

- `npm test`: 45 files, 766 tests, all pass.
- `npm run build`: succeeds.

## Not changed

- No README rewrite (to avoid breaking tests that assert claims).
- No strict security mode yet.
- No clinical validation (requires hardware + clinicians).

---

# Hardening Pass 2

## Security

- `src/lib/care/securityMode.ts` — new `securityMode()`, `isStrictSecurity()`,
  `demoEndpointsEnabled()`, `demoCredentialsEnabled()`, `securityPosture()`.
- `src/app/api/ward/route.ts` — strict: nurse session or 401.
- `src/app/api/notify/route.ts` — requires pair/nurse proof; strict adds
  `requireProof` for unpaired sessions.
- `src/app/api/ingest/route.ts` — strict: 503 without `CARESPEAK_DEVICE_TOKEN`.
- `src/app/api/network-info/route.ts` — empty on Vercel; strict: nurse-only.
- `src/app/api/pair/route.ts` — validates pairing-token format
  (`^[A-Za-z0-9_-]{8,64}$`) before register/rotate/scan.
- `src/app/api/health/route.ts` — reports `securityPosture()`.
- `src/lib/care/auth.ts` — requires both `CARE_NURSE_USER` and `CARE_NURSE_PASS`;
  strict mode removes `nurse.demo`.
- `src/lib/care/sessionAccess.ts` — `requireProof` option.
- `src/app/ward/page.tsx` — explicit "nurse sign-in required" state on 401;
  stops polling until signed in.

## Privacy

- `public/sw.js` — v3: public shell only; clinical/authenticated routes are
  never cached; deletes the v2 cache on activate.

## Accessibility

- `src/components/MotionProvider.tsx` — `MotionConfig reducedMotion="user"`.
- `src/components/RouteFocus.tsx` — focus + live-region announcement on route
  change.
- `src/components/Navbar.tsx` — Escape closes overlays, close on route change,
  `aria-controls`, `aria-current` on language options.
- `src/app/layout.tsx` — wraps the app in `MotionProvider` + `RouteFocus`.

## RAG / CAG

- `src/lib/care/cag.ts` — complete-chart context when the chart fits the budget.
- `src/lib/care/portalBrain.ts` — uses CAG before falling back to retrieval.
- `src/lib/care/retrieval.ts` — confidence counts literal clinical evidence
  (or long typo-length fuzzy hits); excludes short fuzzy collisions and profile
  demographics.

## Convenience

- `src/lib/session.ts` — new session ids are 8 symbols (`SESSION_ID_LENGTH`);
  device suffixes stay 6; existing sessions remain valid.

## Tests

- Added `tests/security-mode.test.ts` (11), `tests/care-cag.test.ts` (5),
  `tests/rag-eval.test.ts` (2) and `tests/fixtures/rag-eval.json`.
- Updated `tests/care-plumbing.test.ts` and `tests/frontend-storage.test.ts` for
  the 8-character session id.
- Added `npm run eval:rag`.
- Total: 766 → 784 passing (48 files).

## Verification

- `npm test`: 48 files, 784 tests, all pass.
- `npm run build`: succeeds.
- `npm run eval:rag`: recall@5 0.957, MRR 0.891, no false positives.

## Still open

- Global (cross-instance) login throttling; retention policy; external audit
  sink; outbound-message paths **UNVERIFIED** without real credentials; clinical
  validation outstanding.