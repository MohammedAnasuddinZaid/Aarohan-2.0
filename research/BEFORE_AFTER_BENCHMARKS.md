# CareSpeak — Before / After (measured)

**Date:** 2026-11-24
**Before:** `148295d` (previous pushed state, `origin/main` at session start)
**After:** `1b2940c` (this pass, local)

Everything in the "after" column was produced by a command run in this working
tree. **There are no latency/FPS/memory benchmarks here** — no GPU, camera,
microphone or phone hardware is available in this environment, so those remain
`UNVERIFIED` (see `SPEECH_LATENCY_OPTIMIZATION.md`). This file reports only what
can be measured on a CPU-only box: tests, the retrieval harness, the build, and
the dependency audit.

---

## 1. Test suite (frontend)

| Metric | Before `148295d` | After `1b2940c` | Δ |
|---|---|---|---|
| Test files | 48 | **52** | +4 |
| Tests | 784 | **817** | **+33** |
| Failing | 0 | **0** | 0 |
| `tsc --noEmit` | **failed** (1 pre-existing error) | **passes** | fixed |

Command: `npx vitest run` and `npm run typecheck`.

The +33 tests:

| New test file | Tests | What it pins |
|---|---|---|
| `tests/aac-phrases.test.ts` | 8 | phrase ids, category grouping, emergency invariant, honest localisation flags |
| `tests/care-fhir.test.ts` | 12 | FHIR-valid ids, LOINC codes, required `content`/`intent`, synthetic tags |
| `tests/retrieval-synonym-safety.test.ts` | 6 | synonym table cannot re-merge medicine/symptom/diagnosis |
| `tests/service-worker-privacy.test.ts` | 4 | `sw.js` never caches `/api/`, `/care`, `/ward`, … |
| `tests/security-mode.test.ts` (extended) | +3 | hosted default is strict; explicit demo opt-in |

## 2. Backend suite

| Metric | Before | After | Δ |
|---|---|---|---|
| Tests | 534 | **534** | 0 (unchanged) |
| Failing | 0 | 0 | 0 |

Command: `backend\.venv\Scripts\python.exe -m pytest -q`. The backend was not
modified this pass.

## 3. Retrieval harness (`npm run eval:rag`)

| Metric | Baseline (in-file comment) | After synonym-safety change | Gate |
|---|---|---|---|
| recall@5 | 0.957 | **0.957** | `>= 0.90` ✅ |
| MRR | 0.891 | **0.891** | — |
| Positive cases | 23 | 23 | — |
| Negative cases reported `strong` | 0 | **0** | must be 0 ✅ |

The *clinical-safety* content of the table changed even though the headline
numbers did not: unsafe cross-category links (`water→furosemide`,
`antibiotic→infection`, `thin→warfarin`, `sugar→blood`) were removed while
medicine↔medicine links were preserved. Result: same recall, strictly safer
expansion. A mid-session draft that removed the medicine links too scored
`0.870 / 0.804`; that draft was **not** shipped.

## 4. Production build

| Metric | Before | After |
|---|---|---|
| `next build` | compiles, ~7 s | **compiles, ~3–7 s** |
| Pages added/verified | — | `hand-mode`, `eye-mode` still build (now include `QuickPhrases`) |
| Warnings | none blocking | none blocking |

Command: `npm run build`. Build time varies with machine cache; the only claim is
"compiles successfully with the new components".

## 5. Dependency audit

| Metric | Before | After |
|---|---|---|
| `npm audit` total advisories | 9 | **5** |
| critical | 3 | 2 (dev-only) |
| high | 5 | 1 (dev-only) |
| moderate | 1 | 2 |
| `next` version | 15.5.20 | **15.5.29** |

Command: `npm audit --json`. Remaining items are the dev-only vitest toolchain and
a Next-bundled `postcss` whose only fix is a Next 16 major upgrade — see
`INSTALLATION_AND_DEPENDENCY_REPORT.md` §2.

## 6. What is deliberately NOT benchmarked

| Thing | Why | Status |
|---|---|---|
| ASR/TTS latency, RTF, first-audio | no audio hardware / GPU here | **UNVERIFIED** |
| Camera FPS / gesture accuracy | no camera here | **UNVERIFIED** |
| Retrieval latency (ms) | not instrumented with a timer harness | **UNVERIFIED** |
| Live Vercel deploy time / cold start | no credentials | **BLOCKED** |
| Multi-instance Redis sync | no Redis credentials | **UNVERIFIED** |

None of these may be cited as measured.
