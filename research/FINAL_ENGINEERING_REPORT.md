# CareSpeak — Final Engineering Report

**Date:** 2026-11-24
**Repository:** `https://github.com/MohammedAnasuddinZaid/Aarohan-2.0.git` (`origin`)
**Previous pushed HEAD:** `148295d` · **This pass:** `cb4755c`, `1b2940c`
**Quality gates at `1b2940c`:** typecheck ✅ · 817/817 frontend tests ✅ ·
534/534 backend tests ✅ · `next build` ✅ · `eval:rag` green ✅

This is the engineering summary. The file-by-file ledger is
`FINAL_IMPLEMENTATION_REPORT.md`; deep findings are `REPOSITORY_DEEP_AUDIT.md`.

---

## 1. What this pass did, in one paragraph

It closed the gap that mattered most for a **public** deployment — a hosted
CareSpeak now defaults to the *strict* security posture instead of exposing the
ward/notify/ingest/sync endpoints — and it made three concrete, tested additions on
top of the existing architecture: a clinically-safe retrieval synonym table, an
accessible AAC phrase panel that works with a keyboard or switch, and a pure FHIR
R4 mapping. It added CI, fixed a pre-existing typecheck failure, and reduced
dependency advisories from 9 to 5. No framework was replaced, no service was
merged, no new runtime dependency was introduced, and no documentation claim was
made that a command in this tree did not produce.

## 2. Engineering decisions and why

| Decision | Rationale |
|---|---|
| Hosted default = strict | A demo flagship security model assumes a trusted local machine. On Vercel that assumption is false, so the safe default must be the closed one; a deliberate public demo opts in with `CARE_SECURITY_MODE=demo`. |
| Keep demo mode locally | Judging/demo must still work on a laptop; the change is scoped to the hosted case. |
| Medicine↔medicine synonyms kept, cross-category removed | Recall and safety are in tension; the resolution is to widen only within a category, never medicine→diagnosis or everyday-word→drug. |
| AAC phrases as authored data, not translated | Emitting an unverified machine translation of a medical phrase is worse than saying it in English; non-gesture phrases are visibly labelled `EN`. |
| FHIR as a pure mapping, no server | There is no FHIR endpoint to talk to; a mapper is useful and testable, a server would be dead weight. |
| No vector DB, no semantic cache | The lexical harness already meets the gate, and approximate matching is unsafe for high-risk clinical queries. |
| CI advisory-only `npm audit` | A pre-existing transitive advisory must never mask a real regression, so audit is reported, not blocking. |

## 3. Required status separation

### 3.1 Implemented and verified (in this environment)

- **Hosted-safe security default** — `src/lib/care/securityMode.ts`; verified by
  `tests/security-mode.test.ts` (hosted → strict; explicit demo opt-in; local → demo).
- **Clinical-safe synonym table** — `src/lib/care/retrieval.ts`; verified by
  `tests/retrieval-synonym-safety.test.ts` and `npm run eval:rag` (0.957/0.891, gate green).
- **AAC phrase library + panel** — `src/lib/care/aacPhrases.ts`,
  `src/components/QuickPhrases.tsx`, wired into `hand-mode`/`eye-mode`; verified by
  `tests/aac-phrases.test.ts` and a green production build.
- **FHIR R4 mapping** — `src/lib/care/fhir.ts`; verified by `tests/care-fhir.test.ts`.
- **Service-worker privacy invariant pinned** — `tests/service-worker-privacy.test.ts`.
- **CI pipeline** — `.github/workflows/ci.yml`; frontend + backend + advisory audit.
- **Typecheck fix** — `tests/care-routes.test.ts`; `npm run typecheck` now passes.
- **Dependency patch** — `next` 15.5.20 → 15.5.29; `npm audit` 9 → 5.

### 3.2 Implemented but not verifiable here

- The CI workflow itself is **written, not executed** on a GitHub runner — its
  steps mirror commands proven locally, but GitHub Actions was not run in this
  environment.
- `QuickPhrases` renders and type-checks, but there is **no browser test** (no
  jsdom/testing-library in this repo and no browser here); behaviour is verified
  only at the data-layer (`aacPhrases.ts`) and via the build.
- The FHIR bundle is validated by unit assertions (id format, codes, required
  fields), **not** by a FHIR validator (`$validate`) — that is a recommended next step.

### 3.3 Investigated but deliberately not implemented

- **Streaming Zipformer ASR** via `sherpa-onnx` — best-indicated path, but Indic
  streaming coverage is unverified and it needs on-device measurement first.
- **Embedding rerank / a vector DB** — no measured need; adding a service is unjustified.
- **Semantic response caching** — unsafe for emergency/high-risk clinical queries.
- **Indic translation (IndicTrans2)** — designed, not built; must include protected
  medication/dosage terms and a confirmation step, and IndicF5 has no license.
- **`vitest` 3 → 5** — a 52-file toolchain major upgrade; dev-only, so deferred.
- **A separate FHIR server (HAPI/Medplum)** — nothing to integrate against.

### 3.4 Blocked by credentials or hardware

- **Vercel deployment** — no credentials/CLI auth; prepared and documented in
  `docs/VERCEL_PRODUCTION_DEPLOYMENT.md`, **not** deployed.
- **ASR/TTS latency and CV accuracy benchmarks** — no GPU/audio/camera hardware.
- **Twilio/Exotel outbound calls, MSG91 SMS, Gemini, Redis multi-instance sync** —
  no live credentials; covered by mocks/unit tests only.
- **Real clinical validation and any HIPAA/GDPR/DPDP compliance claim** — requires
  external review; none is made.

### 3.5 Recommended future work

1. Make `/api/notify` and `/api/pair` safe even in demo (pair-token proof for
   escalation; a registration nonce for pairing).
2. Surface speech-rate/dwell controls in the UI (`saveTTSConfig` exists but is unused).
3. Prototype streaming ASR and **measure** it, then adopt or reject with numbers.
4. Run a real FHIR `$validate` against an exported sample bundle.
5. Rename "CAG" → "complete-chart mode" in UI/docs.
6. Consider a short browser/E2E test harness for the patient pages.

## 4. Residual risk (honest)

The largest remaining risk is unchanged by this pass and is architectural: in an
**explicitly configured demo** deployment the demo endpoints are still open, and a
pre-registered pair token can still seize an unpaired session. The strict hosted
default removes these from a normal Vercel deployment, but the affordances remain
for anyone who sets `CARE_SECURITY_MODE=demo`. Closing them outright is P0 in
`IMPLEMENTATION_ROADMAP.md`. No claim of clinical safety, compliance, or hardware
performance is made anywhere in this pass.
