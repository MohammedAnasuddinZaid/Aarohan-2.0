# Competitive Landscape — AAC & Assistive Communication

Pricing and feature details for commercial products are **UNVERIFIED** here
(no live pricing fetched successfully in this session). Entries below reflect
publicly known product categories and open-source projects whose GitHub
metadata was verified via the GitHub API.

## Commercial AAC (general knowledge, UNVERIFIED pricing)

- **Proloquo2Go / Proloquo4Text (AssistiveWare)** — symbol/text AAC for iPad;
  subscription model. Strong multilingual support; closed ecosystem.
- **TouchChat / LAMP Words for Life (PRC-Saltillo)** — symbol AAC, one-time
  purchase historically; page sets.
- **CoughDrop** — cloud AAC, subscription, team/ward features, open data
  export. Closest competitor for ward-scale care.
- **Grid 3 (Smartbox)** — Windows AAC, eye-tracking integration, high cost.
- **Tobii Dynavox (TD Snap, TD Talk)** — dedicated eye-tracking hardware +
  software; enterprise pricing; clinical validation.
- **Avaz** — Indian-language AAC (relevant to CareSpeak's 9-language claim).
- **Jellow Communicator** — Indian, free, picture-based, low-tech.

## Open-source / research (verified GitHub metadata)

See `TOOLING_AND_LIBRARIES.md` for stars/license/pushed dates.

- **MediaPipe (google-ai-edge/mediapipe)** — the on-device vision stack
  CareSpeak already uses.
- **whisper.cpp / faster-whisper / sherpa-onnx** — on-device ASR options.
- **Silero VAD** — voice activity detection.
- **Piper / Kokoro** — local TTS.
- **LiveKit / Pipecat** — realtime voice agent frameworks.
- **Haystack / LlamaIndex** — RAG frameworks for the records assistant.
- **Qdrant** — vector store for semantic retrieval.
- **Ragas** — RAG evaluation.

## Where CareSpeak could differentiate (analysis, not evidence)

- On-device, privacy-first detection with no video upload (verified).
- Ward-scale multi-patient view with escalation (verified, but unauthenticated).
- Indian-language TTS via local voices (verified fallback behavior).
- Open codebase with tests (verified).

## Where CareSpeak is weaker (honest)

- No clinical validation or certification (UNVERIFIED).
- No dedicated eye-tracking hardware; webcam-only (lower accuracy than Tobii).
- No symbol-based AAC grid (gesture/eye only).
- No offline ASR/TTS beyond browser APIs (VoiceLink needs local backend).
- No independent evaluation of risk scoring.