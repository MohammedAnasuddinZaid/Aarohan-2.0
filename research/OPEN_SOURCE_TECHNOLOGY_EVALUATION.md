# CareSpeak — Open-Source Technology Evaluation

**Date:** 2026-11-24 · **Method:** GitHub REST API (`https://api.github.com/repos/<owner>/<repo>`)
fetched the same day; source read from this repository. Web search was unavailable
(HTTP 402), so every metadata fact is from the API. Star counts are a snapshot.

This file consolidates the verdicts of the domain docs so there is one place to see
what was considered and what was decided. Detail lives in:
`SPEECH_MODEL_COMPARISON.md`, `RAG_CAG_ARCHITECTURE.md`, `HEALTHCARE_INTEROPERABILITY.md`,
`INDIAN_LANGUAGE_AI_RESEARCH.md`, `AAC_AND_ACCESSIBILITY_RESEARCH.md`,
`SPEECH_LATENCY_OPTIMIZATION.md`.

**Headline:** this pass **added no new runtime dependency and no new service.** Every
change was made with what the repository already ships (`next`, `minisearch`,
`sherpa-onnx`, `onnxruntime`, MediaPipe). The evaluation below is what justifies
*not* adding one yet.

---

## 1. Speech — ASR

| Repo | License | Stars | Archived | Pushed | Verdict | Reason |
|---|---|---|---|---|---|---|
| `ggml-org/whisper.cpp` | MIT | 55,469 | no | 2026-11-24 | **RETAIN** | Already shipped (`backend/app/asr.py`); MIT code + MIT weights, no Python ML stack. |
| `k2-fsa/sherpa-onnx` | Apache-2.0 | 16,190 | no | 2026-11-24 | **ADOPT (expand)** | Already a dependency for TTS; same ONNX runtime can host streaming Zipformer ASR. Highest-leverage single addition. Indic streaming models **UNVERIFIED**. |
| `AI4Bharat/IndicConformerASR` | MIT | 108 | no | 2025-06-20 | **TRIAL** | Only credible open ASR covering hi/te/ta/kn/ml, but ships `.nemo` checkpoints needing NeMo + PyTorch; English/code-mixed **UNVERIFIED**; low activity. |
| `SYSTRAN/faster-whisper` | MIT | 26,973 | no | 2026-11-23 | **REJECT (now)** | CTranslate2 duplicates whisper.cpp and adds a second runtime; only pays off for server-side batch, which this product does not need. |
| `AI4Bharat/vistaar` | MIT | 101 | no | 2025-06-08 | **REJECT as runtime** | Benchmark + training-set release, not an inference engine. Keep as evaluation reference. |
| `NVIDIA/NeMo` → `NVIDIA-NeMo/Speech` | Apache-2.0 | 18,783 | no | 2026-11-24 | **TRIAL (forced)** | Heavy torch/CUDA; isolate in a separate optional process. Repo renamed. |

## 2. Speech — TTS

| Repo | License | Stars | Archived | Pushed | Verdict | Reason |
|---|---|---|---|---|---|---|
| `k2-fsa/sherpa-onnx` | Apache-2.0 | 16,190 | no | 2026-11-24 | **RETAIN** | Current TTS engine; offline VITS on CPU, no PyTorch. |
| `hexgrad/kokoro` | Apache-2.0 | 10,342 | no | 2025-08-06 | **TRIAL** | 82M params, Apache-2.0; ONNX + `voices.bin` already local. Quiet repo; a code change in `tts.py`, not a new tree. |
| `AI4Bharat/IndicF5` | **none detected** | 159 | no | 2025-09-24 | **TRIAL (license review first)** | 11 Indic languages incl. all targets, but **no LICENSE file** → do not ship before legal review. Needs PyTorch + a reference prompt. |
| `coqui-ai/TTS` | MPL-2.0 | 46,272 | no | 2024-08-16 | **REJECT** | Most-starred here, weakest fit: >2 years stale, heavy Python/Torch. |
| `rhasspy/piper` | MIT | 11,337 | **yes** | 2025-08-26 | **REJECT (archived)** | Frozen; 418 open issues. |
| `OHF-Voice/piper1-gpl` | **GPL-3.0** | 6,374 | no | 2026-11-23 | **REJECT for embedding** | The *maintained* Piper, but relicensed **GPL-3.0** — a distribution problem for a shipped product. Piper *voice files* can still be consumed via sherpa-onnx. |

## 3. Retrieval / RAG / CAG

| Repo | License | Verdict | Reason |
|---|---|---|---|
| `oramasearch/orama` | `NOASSERTION` (LICENSE text is Apache-2.0) | **TRIAL (deferred)** | In-process hybrid search, no service — but the API license field is unclassified; legal review first. |
| `deepset-ai/haystack`, `run-llama/llama_index` | Apache-2.0 / MIT | **REJECT** | Python orchestration; the app is Next.js/TypeScript with small, patient-scoped charts. |
| `qdrant/qdrant` | Apache-2.0 | **REJECT** | A whole vector-DB service is unjustified: `recall@5=0.957` on the lexical harness, and the misses are status/recency, not vocabulary. |
| `FlagOpen/FlagEmbedding`, `UKPLab/sentence-transformers` | MIT / Apache-2.0 | **REJECT (now)** | Embedding rerank is a *possible* P2 experiment (top-20, cached per chart version) — measure before adopting. |
| `zilliztech/GPTCache` | MIT | **REJECT** | Semantic caching is unsafe here: approximate matches must never answer emergency/high-risk queries. |
| `vibrantlabsai/ragas` | Apache-2.0 | **REJECT (now)** | The repo already has a purpose-built recall/MRR harness with a negative-case gate. |

**Which "caching" this app actually implements:** ordinary app caching + a
patient-scoped, versioned exact-match answer cache. It is **not** semantic
(response) caching and **not** KV-prefix CAG. The doc `RAG_CAG_ARCHITECTURE.md`
explains the distinction and recommends relabelling "CAG" as "complete-chart mode".

## 4. Healthcare interoperability

| Repo | License | Verdict | Reason |
|---|---|---|---|
| `hapifhir/hapi-fhir` | Apache-2.0 | **REJECT (now)** | A full FHIR server is far beyond a mapping; nothing to integrate against yet. |
| `medplum/medplum` | Apache-2.0 | **REJECT (now)** | Same; a hosted EHR platform, not a mapping. |

Shipped instead: `src/lib/care/fhir.ts` — a pure, tested `ClinicalPatient → FHIR R4
Bundle` mapping (mapping only; no server, no network). See
`HEALTHCARE_INTEROPERABILITY.md`.

## 5. Indic language

| Repo | License | Verdict | Reason |
|---|---|---|---|
| `AI4Bharat/IndicTrans2` | MIT | **TRIAL** | 22 scheduled languages, MIT, active; the only credible open MT option. Any adoption needs the protected-terms + confirmation design in `INDIAN_LANGUAGE_AI_RESEARCH.md`. |
| `AI4Bharat/IndicF5` | none | **BLOCKED** | No license file. |
| `indicnlp_suite` | CC0-1.0 | **reference** | Data/tooling, not a translation service. |

This pass shipped **no** translation: a translation layer that silently mutates
medication/dosage terms would be a patient-safety defect. The design is written; the
implementation is deliberately deferred.

## 6. AAC / accessibility

| Repo | License | Verdict | Reason |
|---|---|---|---|
| Eye-gaze / AAC projects (see `AAC_AND_ACCESSIBILITY_RESEARCH.md`) | mostly mixed/unknown asset licenses | **reference** | Borrowed *ideas* (dwell select, switch access, frequent-phrase prediction, emergency always-present) — **not** code or symbol assets. |

Shipped: `src/lib/care/aacPhrases.ts` + `src/components/QuickPhrases.tsx`, authored
here (no third-party code or pictograms copied). Pictogram/symbol licences are
separate from code licences and are **not** used.

---

## 7. What was actually adopted in this pass

| Change | New dependency? | Evidence |
|---|---|---|
| Hosted-safe security default | no | `src/lib/care/securityMode.ts`, `tests/security-mode.test.ts` |
| Clinical-safe synonym table | no | `src/lib/care/retrieval.ts`, `tests/retrieval-synonym-safety.test.ts` |
| AAC phrase library + panel | no (reuses `voiceAlert`, `lucide-react`) | `src/lib/care/aacPhrases.ts`, `src/components/QuickPhrases.tsx`, `tests/aac-phrases.test.ts` |
| FHIR R4 mapping | no | `src/lib/care/fhir.ts`, `tests/care-fhir.test.ts` |
| CI pipeline | no (GitHub Actions) | `.github/workflows/ci.yml` |
| Dependency patches | no new packages | `package-lock.json` (Next 15.5.29) |

**Nothing in this evaluation was adopted as a runtime dependency.** Every external
adoption above is TRIAL/REJECT-pending-measurement, which is the honest state.
