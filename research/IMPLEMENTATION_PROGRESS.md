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