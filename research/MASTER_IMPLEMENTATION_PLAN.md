# Master Implementation Plan — CareSpeak

## Phase 0 — Repository hygiene (DONE this pass)

- Move repo to `Aarohan-2.0`, reset to commit `136c7f9`.
- Add `research/` documentation set.
- Keep `old-origin`, `voicelink`, `web2build` remotes for reference.

## Phase 1 — Security hardening (P0)

Status: partial.

- [x] Sync/stream pair-gating for registered beds.
- [x] Login rate limiting.
- [x] Remote TTS opt-in.
- [ ] Strict security mode (`CARE_SECURITY_MODE`).
- [ ] `/api/ward`, `/api/notify`, `/api/ingest`, `/api/network-info` gating.
- [ ] Server-issued session secret for pair registration.
- [ ] Default-credential refusal in production.
- [ ] Data retention / deletion + TTLs.
- [ ] CSRF review.

## Phase 2 — Accessibility (P1)

Status: partial.

- [x] Skip link, focus-visible, reduced motion, ARIA labels/expanded/current.
- [ ] Full WCAG 2.2 AA audit (axe-core).
- [ ] Keyboard navigation of dropdowns (arrows, Escape, focus trap).
- [ ] `aria-live` gesture announcements.
- [ ] Focus management on route change.
- [ ] Contrast verification.
- [ ] Screen-reader manual test.

## Phase 3 — RAG/CAG/speech/optimization (P2)

Status: not started (research only).

- [ ] CAG mode for small record bundles.
- [ ] Vector retrieval evaluation (MiniSearch vs Qdrant) with a committed dataset.
- [ ] Ragas eval harness.
- [ ] Reproducible latency benchmark script.
- [ ] Local TTS/ASR option evaluation.
- [ ] Service worker cache audit.
- [ ] Load test for ward scale.

## Phase 4 — Clinical safety & compliance (P2)

- [ ] Clinical review of risk scoring.
- [ ] Label all clinical claims UNVERIFIED until validated.
- [ ] Consent + data-processing documentation.
- [ ] GDPR/DPDP deletion path.

## Validation gates

- `npm test` must pass (currently 766).
- `npm run build` must pass.
- No regression in patient-facing flows.
- Every new security control has a test.
- Every performance claim has a committed benchmark.

## Rollback

All changes are additive; revert the commit to return to `136c7f9`. No data
migration performed.