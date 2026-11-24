# CareSpeak — Implementation Roadmap

**Date:** 2026-11-24 · **HEAD:** `1b2940c`
Status legend: **DONE** (shipped + verified this pass) · **PARTIAL** · **PLANNED**
(designed, not built) · **BLOCKED** (needs credentials/hardware/external action).

Prior planning lives in `MASTER_IMPLEMENTATION_PLAN.md` and `FINAL_ENGINEERING_AUDIT.md`;
this file is the current, reconciled status.

---

## P0 — safety / security / correctness

| # | Item | Status | Evidence / next step |
|---|---|---|---|
| P0-1 | Hosted deployments must not run open demo endpoints | **DONE** | `securityMode()` → `strict` when `VERCEL` set; `tests/security-mode.test.ts`. |
| P0-2 | Retrieval must not conflate medicine / symptom / diagnosis | **DONE** | `retrieval.ts` synonym table + `tests/retrieval-synonym-safety.test.ts`; eval gate green. |
| P0-3 | Clinical pages must never be service-worker cached | **DONE (verified, pinned)** | `public/sw.js` v3 + `tests/service-worker-privacy.test.ts`. |
| P0-4 | Emergency answers must bypass any cache | **DONE (verified)** | `portalBrain.ts` emergency short-circuit before `cacheGet`. |
| P0-5 | CI must block a broken build | **DONE** | `.github/workflows/ci.yml`: typecheck + vitest + eval:rag + build + pytest. |
| P0-6 | `/api/notify` unauthenticated dispatch (open demo) | **DONE (provider-gated)** | `src/app/api/notify/route.ts`: `requireProof = isStrictSecurity() \|\| Boolean(process.env.MSG91_AUTH_KEY)`. Keyless demo stays open by design; `tests/pair-route-security.test.ts`. |
| P0-7 | Pre-registered pair token can seize a session | **PARTIAL (mitigated)** | Rotate now requires proof of the current token; register returns 409 on conflict; nurse can reclaim; pairing writes throttled per IP (`src/lib/care/throttle.ts`). Full close still needs a server-issued registration nonce. `tests/pair-route-security.test.ts`. |
| P0-8 | Real clinical validation | **BLOCKED** | Requires hardware + clinician review. |

## P1 — capability / accessibility / interop

| # | Item | Status | Evidence |
|---|---|---|---|
| P1-1 | Keyboard/switch alternative to camera input | **DONE** | `aacPhrases.ts` + `QuickPhrases.tsx`, wired into `hand-mode`, `eye-mode`; `tests/aac-phrases.test.ts`. |
| P1-2 | FHIR R4 mapping for the chart | **DONE** | `src/lib/care/fhir.ts` + `tests/care-fhir.test.ts` (mapping only, no server). |
| P1-3 | Speech-rate / dwell controls surfaced in the UI | **PLANNED** | Research found `saveTTSConfig` is never called from a component and there is no dwell/rate control. Design in `AAC_AND_ACCESSIBILITY_RESEARCH.md`. |
| P1-4 | Indic translation with protected terms | **PLANNED** | Design in `INDIAN_LANGUAGE_AI_RESEARCH.md`; must never silently mutate drug/dose terms. Gated on license review (`IndicF5` has none). |
| P1-5 | `next` dev-toolchain advisories cleared | **PARTIAL** | Production ones fixed; vitest 3→5 is a separate major upgrade. |

## P2 — performance / future

| # | Item | Status | Evidence |
|---|---|---|---|
| P2-1 | Streaming Zipformer ASR via `sherpa-onnx` | **PLANNED** | Only ONNX-native Indic-capable path; Indic streaming models **UNVERIFIED**. Design in `SPEECH_MODEL_COMPARISON.md`. |
| P2-2 | Embedding rerank only if measurement justifies it | **PLANNED** | Measure before adopting (`RAG_CAG_ARCHITECTURE.md` §5). |
| P2-3 | TTS sentence streaming / phrase-audio cache | **PLANNED** | `SPEECH_LATENCY_OPTIMIZATION.md`; every expected benefit is `UNVERIFIED` until measured. |
| P2-4 | Relabel "CAG" → "complete-chart mode" in UI/docs | **PLANNED** | Avoids a false technical claim (`RAG_CAG_ARCHITECTURE.md` §1). |

## Dependency / sequencing constraints

- Every Indic ASR/TTS option introduces **PyTorch**; keep it in a separate optional
  process if ever trialled, to preserve the current zero-PyTorch property.
- Do **not** add a vector DB or semantic cache: the lexical harness meets the gate
  and semantic/approximate matching is unsafe for high-risk clinical queries.
- Do **not** rely on GPL-3.0 `piper1-gpl` in the shipped binary; Piper *voice files*
  can still be used through `sherpa-onnx` (confirm licensing before relying on it).
- `AI4Bharat/IndicF5` has **no license file** → treat as unusable until legal review.

## Definition of done for the next pass

1. P0-6/P0-7: make escalation and pairing safe even in demo, with tests.
2. P1-3: add the speech-rate/dwell UI (uses existing `saveTTSConfig`).
3. P2-1: a *measured* streaming-ASR spike on real hardware, or an explicit "not
   worth it" write-up with numbers.
