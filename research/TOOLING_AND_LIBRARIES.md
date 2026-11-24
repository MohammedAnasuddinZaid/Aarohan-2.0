# Tooling & Libraries — Verified GitHub Metadata

All entries below were fetched from the GitHub REST API on 2026-11-24.
Stars/license/pushed dates are accurate as of that fetch; they change over time.

| Repo | Stars | License | Language | Pushed | Relevance |
|---|---|---|---|---|---|
| ggml-org/whisper.cpp | 55,466 | MIT | C++ | 2026-11-24 | On-device ASR (C/C++) |
| SYSTRAN/faster-whisper | 26,971 | MIT | Python | 2026-11-23 | Fast Whisper transcription |
| k2-fsa/sherpa-onnx | 16,186 | Apache-2.0 | C++ | 2026-11-24 | STT/TTS/diarization, mobile |
| snakers4/silero-vad | 10,756 | MIT | Python | 2026-11-23 | Voice activity detection |
| livekit/agents | (not fetched) | — | — | — | Realtime voice agents |
| pipecat-ai/pipecat | (not fetched) | — | — | — | Voice agent framework |
| deepset-ai/haystack | (not fetched) | — | — | — | RAG framework |
| run-llama/llama_index | (not fetched) | — | — | — | RAG framework |
| qdrant/qdrant | (not fetched) | — | — | — | Vector database |
| vibrantlabsai/ragas | (not fetched) | — | — | — | RAG evaluation |
| ollama/ollama | (not fetched) | — | — | — | Local LLM runtime |
| google-ai-edge/mediapipe | (not fetched) | — | — | — | On-device vision (in use) |
| rhasspy/piper | (not fetched) | — | — | — | Local TTS |
| hexgrad/kokoro | (not fetched) | — | — | — | Local TTS |
| OHF-Voice/piper1-gpl | (not fetched) | — | — | — | Piper v1 |

## Verification status

- Entries marked "(not fetched)" were in the original search list but the
  batched fetch was truncated in the tool result. Treat their star counts as
  **UNVERIFIED** until re-fetched.
- All other numbers are from the GitHub API response captured in this session.

## Recommended adoption (analysis)

- **ASR:** keep browser SpeechRecognition for simplicity; add Whisper (via
  sherpa-onnx WASM or a local backend) for offline/accuracy. Not implemented.
- **TTS:** keep browser speech synthesis; local neural TTS (Piper/Kokoro) only
  if a local backend is acceptable. Remote Google TTS is now opt-in.
- **RAG:** current MiniSearch is deterministic and dependency-free; a vector
  store (Qdrant) only pays off above ~10k records. UNVERIFIED at current scale.
- **Eval:** Ragas is the standard for RAG evaluation; not yet wired.