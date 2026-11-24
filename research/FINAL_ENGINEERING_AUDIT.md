# Final Engineering Audit — Hardening Pass 2

## Build & tests

- `npm run build`: **PASS** (Next.js 15 production build, all routes compiled).
- `npm test`: **PASS** — 48 files / 784 tests.
- `npm run eval:rag`: **PASS** — recall@5 = 0.957, MRR = 0.891, no false positives
  on the committed synthetic eval set (`tests/fixtures/rag-eval.json`).

## Security posture (honest)

**Closed in this pass**

- Explicit `CARE_SECURITY_MODE=demo|strict` (`src/lib/care/securityMode.ts`).
  `CARE_DEMO_MODE=0` is accepted as an alias for strict. `/api/health` now
  reports the active mode and every remaining demo affordance (secret-free).
- `/api/ward`, `/api/notify`, `/api/ingest`, `/api/network-info` are gated:
  strict mode requires a nurse session (ward, network-info), proof of pairing
  (notify), or `CARESPEAK_DEVICE_TOKEN` (ingest).
- `/api/pair` now rejects tokens that fail `^[A-Za-z0-9_-]{8,64}$`, so a
  trivially guessable token can no longer be registered as a capability.
- Demo credentials are refused entirely in strict mode; `CARE_NURSE_USER` and
  `CARE_NURSE_PASS` must both be present.
- New session ids are 8 symbols (~40 bits, up from ~30); device suffixes stay 6.
  Existing 6-character sessions remain valid.
- The service worker (v3) no longer caches clinical/authenticated routes
  (`/care`, `/nurse-view`, `/ward`, `/dashboard`, `/logs`, `/report`, `/cctv`,
  `/api/*`). Cache Storage survives logout, so persisting a ward board was a PHI
  leak to the next user on a shared device.

**Still open (must close before real-patient use)**

- Login throttling is per-instance; a multi-instance deployment needs a shared
  counter (Upstash) to make the limit global.
- No data-retention or deletion policy is enforced in code.
- Pre-registration of a bed by an attacker remains a residual **denial of
  service** (a mismatched token still cannot write), not a read leak.
- No key rotation or audit-log shipping to an external sink.
- Redis / Twilio / Gemini / MSG91 credentials are unavailable here, so the
  multi-instance and outbound-message paths are **UNVERIFIED** end to end.
- Ward, notify and escalation still *function* in demo mode by design; a demo
  deployment must stay synthetic. See `SECURITY_PRIVACY_AUDIT.md`.

## Accessibility posture

- `MotionConfig reducedMotion="user"` (`MotionProvider`) honours the OS
  preference for Framer Motion, complementing the CSS block.
- `RouteFocus` moves focus to `#main-content` and announces the new page's `h1`
  on client navigation (first load is skipped).
- Navbar: Escape closes any overlay, menus close on route change,
  `aria-controls`/`aria-expanded`/`aria-current` set on triggers and language
  options.

Not a full WCAG audit. Remaining items are listed in `ACCESSIBILITY_AUDIT.md`.

## RAG / CAG

- New `src/lib/care/cag.ts` preloads the whole chart when it fits the budget
  (complete-chart context), falling back to retrieval otherwise.
- Retrieval confidence now counts only terms that literally appear in
  substantive clinical passages (or long, typo-length fuzzy hits). Short fuzzy
  collisions ("bread" ~ "breath") and demographics like a room named "Home
  care" can no longer fake a grounded answer. This fixed a real false positive
  the eval caught.
- The eval dataset and harness are committed and run in CI-able form.

## Performance claims

- None newly claimed. All prior latency numbers remain **UNVERIFIED** — no
  hardware, real dataset, or load test was available here.

## Clinical claims

- No clinical validation performed. Risk scoring is a heuristic, not a device.
  All clinical claims remain **UNVERIFIED**. Clinician review with real data is
  required before any medical claim.

## Production readiness verdict

**Still not production-ready for real patients.** It is a hardened, deployable
demo with synthetic data: the P0 access-control items from pass 1 are now closed
behind an explicit strict mode, PHI is no longer cached, and the retrieval path
is measured. Before real-patient use, set `CARE_SECURITY_MODE=strict`, move the
login throttle to a shared store, add a retention policy and external audit
sink, and complete clinical validation.
