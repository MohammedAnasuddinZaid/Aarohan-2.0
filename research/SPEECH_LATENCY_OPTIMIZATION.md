# Speech Latency Optimization — CareSpeak VoiceLink

Planning document. **No latency was measured while writing this document** — this
pass was a read-only source review, so every number in §2 is reproduced
**verbatim** from `PERFORMANCE_REPORT.md` and is **historical / UNVERIFIED
here**. Every optimization idea in §4 is **UNVERIFIED** until it is run against
the same instrumentation described in §3.

The purpose of this document is the missing half of `PERFORMANCE_REPORT.md`:
where the time actually goes (a stage-by-stage waterfall), exactly where to
instrument each stage in this codebase, and which changes are worth trying first.

---

## 1. How to read this document

| Label | Meaning |
|---|---|
| **VERIFIED (code)** | A fact confirmed by reading the source at commit `148295de1bb248fb74056253800ed34f969476a6` |
| **VERBATIM / UNVERIFIED-here** | A figure quoted exactly from `PERFORMANCE_REPORT.md`; not reproduced in this pass |
| **UNVERIFIED** | A proposed change or expected effect; nothing was benchmarked |

No hardware or GPU benchmark was run for this document. The only machine with a
matching model stack is described in `PERFORMANCE_REPORT.md` and was **not**
available to this review session, so the baseline below is quoted, not measured.

---

## 2. Baseline (reproduced verbatim from `PERFORMANCE_REPORT.md`)

> Source: `PERFORMANCE_REPORT.md`, "All numbers below were **measured on this
> machine**, not estimated." Quoted here as history. **UNVERIFIED in this
> document.**

### 2.1 Test conditions (verbatim)

| Item | Value |
|---|---|
| Machine | Dell G15 5530, i5-13450HX (10C/16T), 16 GB RAM, RTX 3050 6 GB |
| Compute used | **CPU only** — the GPU was ~87% occupied by another process (`llama-server.exe`, 5319/6144 MiB) |
| ASR | whisper.cpp `b5454` CPU build, `ggml-base.en.bin` |
| LLM | Ollama 0.40.9, `qwen2.5:3b`, warm |
| TTS | sherpa-onnx 2.0.1, VITS-LJS, 4 threads, 22.05 kHz |
| VAD | Silero ONNX, 256-sample windows |
| OS | Windows 11 build 26200 |

> "Because the CPU was shared with other work, latency varied a lot between
> runs. Best/median/worst are reported rather than a single flattering number."

### 2.2 ASR — whisper base.en, CPU (verbatim summary)

> - **Best 448 ms · median ~475 ms · worst 621 ms** for 2–3 second utterances.
> - Accuracy: 4/6 exactly verbatim, 2/6 with a trivial inflection/plural difference.

### 2.3 TTS — sherpa-onnx VITS-LJS, CPU, 4 threads (verbatim)

| Sentence | Synthesis | Audio | RTF |
|---|---|---|---|
| "How are you feeling today, Asha?" | 362 ms | 2115 ms | **0.171** |
| "Please tell me more about when the dizziness started." | 518 ms | 3079 ms | **0.168** |
| "You should contact your nurse if the symptoms get worse." | 1356 ms | 3460 ms | 0.392 |

> - Model load: **791–814 ms** once; self-test: **103 ms**.
> - **Best RTF 0.168 · typical ~0.17 · worst 0.392** (the worst run collided with LLM work on the same CPU).

### 2.4 LLM — Ollama qwen2.5:3b, CPU, warm (verbatim)

| Run | First token | Total | Tokens | Throughput |
|---|---|---|---|---|
| 1 | 245 ms | 1141 ms | 22 | 19.3 tok/s |
| 2 | **63 ms** | 966 ms | 22 | 22.8 tok/s |

> - Warm-up call reported **143 ms** when the model was already resident; the very first cold start after boot was 3.7 s (health warm-up) to 4.6–5.2 s.
> - **Best first token 63 ms · median ~150 ms · worst (cold) ~4.6–5.2 s.**
> - Ollama reported `size_vram: 0` throughout: pure CPU inference.

### 2.5 End-to-end turns (verbatim)

| Scenario | ASR | First token | TTS first | **First audio** | Notes |
|---|---|---|---|---|---|
| Typed turn, heavy CPU load | — | 3313 ms | 1446 ms | 5884 ms | Other CPU work running |
| Typed turn, heavy CPU load (repeat) | — | 3360 ms | — | 6865 ms | Other CPU work running |
| Spoken turn (VAD + whisper) | 481 ms | 723 ms | 476 ms | **1499 ms** | Engine warm |
| Spoken turn (repeat) | 492 ms | — | — | 2485 ms | Engine warm |
| Typed turn, lighter load | 123–197 ms (token) | — | 1231 ms | ~2.2–4.9 s | See note |

> - **Best first audio ~1.5 s · typical 2.5–6 s · worst ~6.9 s** on this CPU-only, contended machine.
> - The gap between typed and spoken turns is mostly LLM first-token time, which swings with CPU contention; ASR itself is consistently under 0.7 s.
> - The reply is streamed sentence by sentence, so the user hears the first sentence while the rest is still being generated.

### 2.6 Barge-in (verbatim)

> - VAD fired `speech_start` with `barge_in: true` at probability **0.776**.
> - The in-flight turn was cancelled, the app emitted `interrupted` (`reason: barge_in`) and returned to `LISTENING`.
> - The interrupting sentence was transcribed (ASR **468 ms**) and answered in a new turn.

### 2.7 Health / startup (verbatim)

| Check | Measured |
|---|---|
| Backend `/health` with `refresh=true`, all checks true | ready |
| TTS model load during health | 814 ms |
| TTS self-test | 103 ms |
| LLM warm-up | 143 ms warm / 3651 ms cold |
| whisper server auto-start | starts on first use, then reused |

**Read-through of the baseline (interpretation, not new measurement):** the
first-audio budget is dominated by LLM first-token time and its variance, not by
ASR or TTS. TTS is ~2.5× faster than real time even in the worst case, and ASR
stays under 0.7 s. That motivates the ordering in §4.

---

## 3. Latency waterfall template

This is a **template**. It defines the stages, the exact code boundary to time,
and the instrument already present, so a future run can fill it with real values.
**No values are claimed here.** Empty cells are deliberate.

### 3.1 Stage boundaries and instruments (VERIFIED in code)

| # | Stage | Start boundary | End boundary | Primary instrument (file → function) | Metric already produced |
|---|---|---|---|---|---|
| 0 | **Capture** | mic `AudioWorkletNode` attached | first PCM frame sent on the socket | `src/hooks/useVoiceCall.ts` → `attachCapture` (378-408), `sendFrame` (390-395), `downmixToPcm16` (148) | none |
| 1 | **VAD (speech start)** | frame fed to `VADStream.feed` | `speech_start` event emitted | `backend/app/vad.py` → `VADStream.feed` (115-219), `_infer` (102) | `prob`, `barge_in` on the `vad` event (`call_manager.py:480-489`) |
| 2 | **Endpointing** | last voiced frame | `speech_end` emitted (`silence`/`max_utterance`) | `backend/app/vad.py` → `feed` silence accumulator (190-219) | `duration_ms`, `reason` (`call_manager.py:492-502`) |
| 3 | **ASR** | `_schedule_turn` runs `transcribe` | transcript returned | `backend/app/asr.py` → `transcribe` (170-218), `resample_linear` (40), `wav_bytes_from_float` (26) | `elapsed_ms` (`asr.py:215`) → turn `asr_ms` (`call_manager.py:592`) |
| 4 | **Intent / emergency** | `detect_emergency(user_text)` | reply branch chosen | `backend/app/security.py` → `detect_emergency` (158-171); frontend `src/lib/care/agent.ts` `extractSymptoms` | none (no timer) |
| 5 | **Retrieval / context** | `prompts.build_messages` called | messages assembled | `backend/app/prompts.py` → `build_messages` (83); web app `src/lib/care/portalBrain.ts` → `buildPortalContext` (524) | none |
| 6 | **LLM** | `stream_chat` awaited | first delta / stream done | `backend/app/llm.py` → `stream_chat` (98-173) | `first_token_ms`, `total_ms` (`llm.py:126,156-157,172-173`) → turn `llm_first_token_ms`, `llm_total_ms` (`call_manager.py:715-724`) |
| 7 | **TTS** | candidate sentence passed to `synthesize` | wav bytes ready | `backend/app/tts.py` → `synthesize` (231-235), `_synthesize_sync` (202-227), `StreamingTTSChunker` (88-134) | `gen_ms` → turn `tts_first_ms`, `tts_total_ms`, `tts_sentences` (`call_manager.py:823-827`) |
| 8 | **Playback** | audio frame queued client-side | `source.start()` / `onended` | `src/hooks/useVoiceCall.ts` → `playQueue` (282-328), `decodeAudioData` (293) | playback ack via `playback_done` (`useVoiceCall.ts:260-264`) |
| ↑ | **First audio (roll-up)** | turn start | first audio frame sent | `backend/app/call_manager.py` → `_speak_sentence` (831-833) | turn `e2e_first_audio_ms` (`call_manager.py:553-564,831-833`) |

### 3.2 Fillable waterfall (to be produced by a real run)

| Stage | p50 | p90 | worst | Source of value |
|---|---|---|---|---|
| Capture → VAD start | | | | *not instrumented yet* |
| VAD start → endpoint | | | | `duration_ms` on `speech_end` |
| Endpoint → ASR done | | | | `asr_ms` |
| Intent | | | | *not instrumented yet* |
| Retrieval | | | | *not instrumented yet* |
| LLM first token | | | | `llm_first_token_ms` |
| LLM total | | | | `llm_total_ms` |
| TTS first sentence | | | | `tts_first_ms` |
| First audio (roll-up) | | | | `e2e_first_audio_ms` |
| Playback start (client) | | | | *not instrumented yet* |

### 3.3 How to collect it (VERIFIED in code)

1. The backend already emits a per-turn `metrics` object on `assistant_end` and a
   standalone `metrics` event (`backend/app/call_manager.py:553-564,895-904`).
   Run a live WebSocket call and capture those events — that fills every row
   except Capture, Intent, Retrieval and Playback.
2. The backend reports aggregate turn history from `CallSession.snapshot_metrics`
   (`backend/app/call_manager.py:169-182`); call records are readable at
   `GET /api/voicelink/history` (`backend/app/main.py:139-150`).
3. To fill the three uninstrumented stages, add `time.perf_counter()` around
   `detect_emergency` (`call_manager.py:632`) and `build_messages`
   (`call_manager.py:656`), and a client-side `performance.now()` at
   `source.start()` in `useVoiceCall.ts` (`playQueue`, ~309). These are additive
   timers; they do not change behaviour.
4. Hardware caveat for any run: the baseline was CPU-only with the GPU busy.
   Any new run must record the same fields (CPU, GPU occupancy, model, threads)
   as §2.1 or it is not comparable.

---

## 4. Prioritized optimization plan

Each item states the hypothesis, the exact place to change, and what to measure.
**All expected effects are UNVERIFIED.**

### P1 — Model keep-alive and warm-up on first use (highest leverage) [UNVERIFIED]

- **Why:** the baseline's worst case is a *cold* model, not a slow model — the
  report's cold-start LLM warm-up was 3651 ms vs 143 ms warm. The single largest
  avoidable latency is a request that arrives before the model is resident.
- **Already present (VERIFIED):** `OLLAMA_KEEP_ALIVE` defaults to `30m`
  (`backend/app/config.py:87`); the engine warms TTS and VAD concurrently at
  start (`backend/app/engine.py:29-33`); LLM warm-up measures `warmup_ms`
  (`backend/app/llm.py:72-94`); health checks can refresh on demand
  (`backend/app/main.py:108-125`).
- **To change:** ensure a warm-up runs before the first user turn (not only at
  process start), and surface per-model warm state through
  `engine._warm_status` (`backend/app/engine.py:27`).
- **Measure:** `warmup_ms` warm vs cold; `llm_first_token_ms` on the first turn
  of a call vs steady state (`call_manager.py:716`).

### P2 — Stream ASR partials into the endpoint decision [UNVERIFIED]

- **Why:** the baseline collects a full utterance, then transcribes it
  (`asr.py:170-218` runs after `vad.py` ends the turn). Overlapping ASR with
  speech would remove most of `asr_ms` (~475 ms median) from the perceived path.
- **To change:** feed the VAD-labelled utterance to `transcribe` incrementally,
  or start a rolling whisper request as voiced audio accumulates in
  `VADStream._chunks` (`backend/app/vad.py:153,178`).
- **Measure:** endpoint→ASR-done minus overlap; confirm no accuracy regression
  against the 4/6-verbatim baseline.

### P3 — Endpointing tuning (`vad_silence_ms`) [UNVERIFIED]

- **Why:** the turn cannot begin until silence is confirmed. The default waits
  `VAD_SILENCE_MS=850` (`backend/app/config.py:127`); that wait is pure added
  latency for a decisive speaker.
- **To change:** lower `vad_silence_ms` (and/or make it adaptive using the
  `prob` stream from `vad.py:102-115`) while keeping `vad_min_speech_ms=260` and
  `vad_preroll_ms=400` to avoid clipping.
- **Measure:** `duration_ms`/`reason` on `speech_end` (`call_manager.py:492-502`)
  versus the false-truncation rate.

### P4 — Speak the first sentence as early as possible [UNVERIFIED]

- **Why:** first audio (best ~1.5 s, typical 2.5–6 s) is what the caller feels.
  The code already streams sentence by sentence (`StreamingTTSChunker`,
  `call_manager.py:659,703-712`) and caps speech at 2 sentences / 55 words
  (`call_manager.py:670-682`).
- **To change:** verify the first `speak_candidate` fires on the earliest
  sentence boundary (`tts.py:114-127`) and lowers `TTS_MAX_SENTENCE_CHARS`
  (`config.py:111`) so the first chunk is short.
- **Measure:** `tts_first_ms` and `e2e_first_audio_ms` (`call_manager.py:824-833`).

### P5 — Common-phrase audio cache [UNVERIFIED]

- **Why:** some utterances are fixed and known before the call: the greeting
  (`backend/app/prompts.py:66-72`), the emergency reply
  (`backend/app/security.py:174-191`), and the LLM-unavailable line
  (`prompts.py:75-80`). Pre-synthesizing them removes a TTS round-trip from
  those turns entirely.
- **To change:** synthesize greeting/emergency/fallback at engine start
  (`engine.py:29-33`) and reuse the wav in `_speak_sentence`
  (`call_manager.py:796-843`).
- **Measure:** `tts_first_ms` on greeting and emergency turns; TTS model
  load/self-test (`PERFORMANCE_REPORT.md` §2.3, §2.7) must not regress startup.

### P6 — Cancellation and barge-in responsiveness [UNVERIFIED]

- **Why:** a caller who is interrupted mid-reply should not wait for the
  in-flight turn. Barge-in already works (VAD `barge_in` at p=0.776 in the
  baseline; `call_manager.py:490-491` calls `interrupt`).
- **To change:** reduce `VAD_BARGE_IN_MS` from 140 (`config.py:129`) if the
  false-trigger rate allows; ensure `cancel_event` (`call_manager.py:569`) stops
  TTS and the LLM promptly.
- **Measure:** time from barge-in `speech_start` to `interrupted` emission, and
  the resulting `asr_ms` for the interrupting sentence (baseline 468 ms).

### P7 — Keep TTS off the LLM's CPU contention path [UNVERIFIED]

- **Why:** the baseline's worst TTS RTF (0.392) and worst LLM first token both
  coincided with concurrent CPU work; TTS threads default to 4
  (`TTS_THREADS`, `config.py:108`) and whisper threads to half the cores
  (`WHISPER_THREADS`, `config.py:100`).
- **To change:** pin thread counts so ASR/TTS/LLM do not oversubscribe the same
  cores; consider running TTS on a worker thread pool (it is threaded already,
  `backend/app/tts.py:6-8`).
- **Measure:** RTF and `llm_first_token_ms` under a deliberately loaded CPU,
  matched to the §2.1 conditions.

---

## 5. What NOT to optimize yet

- **TTS is not the bottleneck.** Even the worst quoted RTF (0.392) is ~2.5×
  faster than real time, so effort belongs in LLM first-token and endpointing
  before TTS tuning (P4/P5 are small wins, P1–P3 are the big ones).
- **Don't chase the absolute best-case number.** The report explicitly warns the
  spread is CPU contention; optimize the p90/worst case on an idle machine, not
  the 63 ms best first token.

---

## 6. Limitations of this document

- **No measurement was performed here.** This was a static, read-only review.
  Every figure in §2 is quoted from `PERFORMANCE_REPORT.md` and labelled
  historical / UNVERIFIED-here.
- **No GPU or hardware benchmark could be run in this environment.** The model
  stack (whisper.cpp, sherpa-onnx, Ollama, Silero) was not executed; GPU
  behaviour is not claimed at all.
- **The waterfall in §3.2 is empty on purpose.** It is a template plus the exact
  code boundaries to instrument; filling it requires a live call on the machine
  described in §2.1.
- **All optimization effects are UNVERIFIED.** No change in §4 has been
  implemented or timed. Several are partially present already (P1, P4, P6) and
  the plan is to make them robust, not to introduce them from scratch.

---

## 7. Source map

| Claim | Source |
|---|---|
| All baseline figures | `PERFORMANCE_REPORT.md` (quoted in §2) |
| Turn metrics keys (`asr_ms`, `llm_first_token_ms`, `e2e_first_audio_ms`, …) | `backend/app/call_manager.py:553-564,592,715-724,823-833` |
| ASR timing | `backend/app/asr.py:170-218` |
| VAD / endpointing | `backend/app/vad.py:102-219` |
| LLM streaming + warm-up | `backend/app/llm.py:72-173` |
| TTS synthesis + chunker | `backend/app/tts.py:64-134,202-235` |
| Engine warm-up | `backend/app/engine.py:29-33` |
| Tuning knobs | `backend/app/config.py:87-131,155-156` |
| Frontend capture/playback | `src/hooks/useVoiceCall.ts:148,282-408` |
