# RAG, CAG & Speech Research — CareSpeak

## 1. Current RAG (verified)

- **Index:** `src/lib/care/retrieval.ts` uses MiniSearch with synonyms and typo
  tolerance. Index is cached (see `care-rag.test.ts`, `care-rag-edge.test.ts`).
- **Answers:** `src/lib/care/assistant.ts` deterministic nurse Q&A; optional
  Gemini grounding via `src/lib/care/gemini.ts`. `portalBrain.ts` adds SBAR
  and session linking.
- **Grounding rule:** prompts forbid fabrication; fallback is local.
- **Tests:** 26 assistant + 21 routing-deep + rag/rag-edge tests pass.

## 2. Cache-Augmented Generation (CAG) — research note

CAG pre-loads a stable corpus into the model context (or a KV cache) instead of
retrieving per query. For CareSpeak's records (bounded, per-patient, slowly
changing), CAG is attractive: deterministic, no retrieval latency, no
hallucinated citations beyond the loaded text. Trade-offs:

- Context window limits (records must fit; chunking/summarisation needed).
- Stale data if records change mid-session.
- Cost/latency of long prompts on every turn.
- No per-query relevance ranking; whole-corpus attention.

**Recommendation:** keep MiniSearch as the source of truth; add an optional CAG
mode that serialises the patient's record bundle into the Gemini prompt when the
bundle is small (< ~4k tokens), and fall back to retrieval otherwise. Measure
with Ragas. Not implemented.

## 3. Speech pipeline (verified)

- TTS: browser SpeechSynthesis primary; remote Google TTS now opt-in only.
- VAD/ASR: optional browser AI (WebLLM/Whisper, opt-in, never auto-downloaded).
- VoiceLink: local Whisper + Ollama + VITS, WebSocket, barge-in.
- Latency numbers in `PERFORMANCE_REPORT.md` are **UNVERIFIED** (no benchmark
  harness in repo). Do not cite externally.

## 4. What would make claims defensible

- A reproducible benchmark script (audio file → transcript → reply) with
  p50/p95 latency and WER, committed to the repo.
- A Ragas eval set over the records assistant (faithfulness, answer relevance,
  context precision) with a committed dataset.
- A clinical review of the risk scoring against a labelled dataset (currently
  absent). All clinical-accuracy claims remain UNVERIFIED.

## 5. Honest gaps

- No vector search in production; MiniSearch only.
- No eval harness committed.
- No latency benchmarks committed.
- No clinical validation.