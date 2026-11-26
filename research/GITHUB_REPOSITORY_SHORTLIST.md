# GitHub Repository Shortlist - ASR & TTS for CareSpeak / VoiceLink

All metadata below was fetched from the **GitHub REST API** (`https://api.github.com/repos/<owner>/<repo>`)
on **2026-11-24** (responses carried `updated_at` values around `09:31Z`-`09:34Z`).
No web search was used. Star counts drift hourly; treat them as a snapshot, not a constant.

Two earlier documents in this folder (`SOURCES.md`, `TOOLING_AND_LIBRARIES.md`) recorded slightly lower
star counts for the same repos (e.g. whisper.cpp 55,466 vs 55,469 here). That is drift between fetches,
not a contradiction.

## What the project actually ships today (read from source)

| Component | Implementation | Evidence |
|---|---|---|
| ASR | `whisper.cpp` HTTP server, `ggml-base.en.bin`, English-only, one utterance per request | `backend/app/asr.py`, `backend/app/config.py` (`whisper_model`, `whisper_language="en"`) |
| Segmentation | Silero VAD v5 ONNX, 256-sample (16 ms) chunks, barge-in support | `backend/app/vad.py` |
| TTS | `sherpa-onnx` **OfflineTts** VITS LJSpeech, single voice (`sid=0`), sentence-chunked | `backend/app/tts.py`, `TTS_ENGINE=sherpa` |
| LLM | Ollama `qwen2.5:3b` (streaming, local) | `backend/app/llm.py`, `config.py` |
| Wiring / health | `VoiceEngine` composition root, readiness = db + ollama + whisper + tts + vad | `backend/app/engine.py` |
| Deps | `sherpa-onnx==2.0.1`, `onnxruntime==1.23.2`, `numpy==2.2.6`, `fastapi==0.162.0` - **no torch, no transformers** | `backend/requirements.txt` |

Local model files present on disk (measured, not estimated):

- `backend/models/whisper/ggml-base.en.bin` - **141.1 MB** (English-only checkpoint)
- `backend/models/tts/sherpa-ljs/vits-ljs.onnx` - **108.8 MB** (+ `lexicon.txt`, `tokens.txt`)
- `backend/models/tts/sherpa-kokoro/model.onnx` - **329.5 MB**, `voices.bin` 5.5 MB, `tokens.txt`, `LICENSE`
- `backend/models/tts/sherpa-vits/en_US-libritts_r-medium.onnx` - **74.9 MB** (a Piper voice, unused by `tts.py`)
- `backend/models/vad/silero_vad.onnx` - **2.2 MB**
- `backend/models/whisper.cpp/{cpu,cuda}/Release/whisper-server.exe` - both present

Notable wiring facts that constrain the comparison:

1. `tts.py` hard-raises unless `TTS_ENGINE=sherpa`; the Kokoro and Piper files on disk are **not reachable**
   through the current code path. `tts_voice = af_heart` in config is unused by `SherpaTTS`.
2. ASR is **request/response per utterance**, serialized by `asyncio.Semaphore(1)` - there is no token-level
   streaming ASR at the engine layer. The "streaming" feel comes from VAD segmentation plus sentence-chunked TTS.
3. `requirements.txt` pins `sherpa-onnx==2.0.1`; the latest release at fetch time is **v2.0.3** (2026-11-22).

---

## ASR repositories

| Repository | Resolved `full_name` | License (SPDX) | Stars | Archived | Pushed | Open issues | Default branch | Adopt / trial / retain / reject |
|---|---|---|---|---|---|---|---|---|
| `ggml-org/whisper.cpp` | same | MIT | 55,469 | false | 2026-11-24T09:03:04Z | 369 | `master` | **RETAIN** - already in production here; MIT code + MIT weights, CPU/CUDA binaries checked in, no Python ML stack. |
| `SYSTRAN/faster-whisper` | same | MIT | 26,973 | false | 2026-11-23T20:40:19Z | 22 | `master` | **REJECT (for now)** - CTranslate2 path duplicates whisper.cpp, adds a second inference runtime and Python coupling; only pays off for server-side batch throughput, which this product does not need. |
| `k2-fsa/sherpa-onnx` | same | Apache-2.0 | 16,190 | false | 2026-11-24T09:17:02Z | 664 | `master` | **ADOPT (expand)** - already a dependency for TTS; same ONNX runtime can host *streaming* Zipformer ASR, replacing per-utterance Whisper latency. Highest-leverage single addition. |
| `AI4Bharat/IndicConformerASR` | same | MIT | 108 | false | 2025-06-20T10:29:11Z | 26 | `master` | **TRIAL** - only credible open option covering all four target Indic languages, but ships `.nemo` checkpoints needing NeMo + PyTorch, not ONNX. Small repo, low activity - treat as a model drop, not a maintained library. |
| `AI4Bharat/vistaar` | same | MIT | 101 | false | 2025-06-08T12:12:23Z | 13 | `master` | **REJECT as runtime / retain as evaluation reference** - it is a benchmark + training-set release, not an inference engine. Useful only for methodology and test data. |
| `NVIDIA/NeMo` | **`NVIDIA-NeMo/Speech`** (API redirect) | Apache-2.0 | 18,783 | false | 2026-11-24T09:19:53Z | 469 | `main` | **TRIAL (forced by IndicConformer)** - heavyweight (`torch` + CUDA stack) and violates the current "no PyTorch" property, so isolate it in a separate optional process if trialled. Note the repo has been renamed; `NVIDIA/NeMo` now resolves to `NVIDIA-NeMo/Speech`. |

### ASR notes

- **Streaming Zipformer/Conformer in sherpa-onnx:** confirmed present in the repo README's streaming ASR table
  (`sherpa-onnx-streaming-zipformer-en-20M-2023-02-17`, `...-bilingual-zh-en-2023-02-20`, plus `-zh-14M`, `-ko`, `-fr`),
  and the docs list `online-transducer` / `online-ctc` / `online-paraformer` families. **No Indic-language streaming
  Zipformer appears in the README's model tables** - Hindi/Telugu/Tamil/Kannada/Malayalam ASR via sherpa-onnx is
  therefore **UNVERIFIED**, not assumed.
- **IndicConformerASR language coverage (from its README):** 22 scheduled languages - `as, bn, brx, doi, gu, hi, kn, kok,
  ks, mai, ml, mni, mr, ne, or, pa, sa, sat, sd, ta, te, ur`, plus one 600M `multi` hybrid-RNNT checkpoint.
  All four targets are covered: **Hindi (`hi`), Telugu (`te`), Tamil (`ta`), Kannada (`kn`), Malayalam (`ml`)**.
  **English is not in the monolingual list**, so English / code-mixed "Hinglish" coverage is **UNVERIFIED** - a
  material gap for this product, whose callers mix English and Indic.
- `IndicConformerASR` repo metadata: no `description`, `language: null`, 14 forks - essentially a model card plus
  links, which matches its last push of 2025-06-20.

---

## TTS repositories

| Repository | Resolved `full_name` | License (SPDX) | Stars | Archived | Pushed | Open issues | Default branch | Adopt / trial / retain / reject |
|---|---|---|---|---|---|---|---|---|
| `k2-fsa/sherpa-onnx` | same | Apache-2.0 | 16,190 | false | 2026-11-24T09:17:02Z | 664 | `master` | **RETAIN** - current TTS engine; offline VITS works on CPU with no PyTorch. |
| `hexgrad/kokoro` | same | Apache-2.0 | 10,342 | false | 2025-08-06T22:28:53Z | 228 | `main` | **TRIAL** - 82M params, Apache-2.0, model already downloaded locally (`model.onnx` 329.5 MB + `voices.bin`). Plausible naturalness win for English; repo itself is quiet since 2025-08 and is a JS-first wrapper around HF weights. |
| `AI4Bharat/IndicF5` | same | **none detected by API (`license: null`)** | 159 | false | 2025-09-24T06:20:09Z | 31 | `main` | **TRIAL (license review first)** - 11 Indian languages incl. Hindi, Kannada, Malayalam, Tamil, Telugu; near-human claims are the authors' own. Requires a reference prompt audio to clone, plus `transformers`/PyTorch. **No LICENSE file and no license section in the README** - do not ship before legal review. |
| `coqui-ai/TTS` | same | MPL-2.0 | 46,272 | **false** | **2024-08-16T12:07:14Z** | 2 | `dev` | **REJECT** - highest star count of any repo here, but last push is >2 years before the other entries and only 2 open issues (activity has moved elsewhere). Heavy Python/Torch stack, contradicting the current zero-PyTorch deployment. |
| `rhasspy/piper` | same | MIT | 11,337 | **true (archived)** | 2025-08-26T15:01:29Z | 418 | `master` | **REJECT (archived / superseded)** - API returns `"archived": true`; 418 open issues on a frozen repo. Development moved to `piper1-gpl`. |
| `OHF-Voice/piper1-gpl` | same | **GPL-3.0** | 6,374 | **false** | 2026-11-23T23:15:57Z | 70 | `main` | **REJECT for embedding / trial only as a separate process** - this is the **maintained** Piper (pushed 2026-11-23, created 2025-03-28, latest release v1.8.0 on 2026-09-04), but the license changed from MIT to **GPL-3.0**, which is a distribution problem for a shipped product. |

### TTS notes

- **Piper, resolved definitively from API evidence:** `rhasspy/piper` -> `archived: true`, `pushed_at: 2025-08-26`.
  `OHF-Voice/piper1-gpl` -> `archived: false`, `pushed_at: 2026-11-23`, `license: GPL-3.0`, created 2025-03-28
  (i.e. it is the successor, created after the original went dormant). The successor is **maintained but GPL-3.0**;
  the original is **MIT but archived**.
- A Piper voice already sits in the repo (`models/tts/sherpa-vits/en_US-libritts_r-medium.onnx`, 74.9 MB) and is loaded
  by nothing. If Piper voices are wanted, the *voice files* can be consumed through sherpa-onnx without adopting
  the GPL-3.0 `piper1-gpl` binary - that is a licensing detail worth confirming before relying on it.
- Kokoro's repo `language` field is `JavaScript`; the usable artifact here is the ONNX export + `voices.bin`, already
  local, so adopting it is a code change in `tts.py`, not a new dependency tree.

---

## Cross-cutting observations

- The current stack is deliberately dependency-light: **two ONNX runtimes (`sherpa-onnx`, `onnxruntime`) plus a native
  binary**. Every Indic option on this list (IndicConformer, IndicF5, NeMo) drags in PyTorch.
- Three of the strongest signals point the same way: sherpa-onnx is the only repo that is simultaneously
  Apache-2.0, actively pushed (2026-11-24), and already installed - it is both the lowest-risk ASR *and* TTS path.
- Stars are a poor proxy here: `coqui-ai/TTS` (46k) is the most-starred repo on the list and the weakest fit.

---

## Verification statement

**Web search was unavailable during this task (HTTP 402 on the search backend), so no search engine results were
used.** Every repository fact in this document - `full_name`, `license.spdx_id`, `stargazers_count`, `archived`,
`pushed_at`, `open_issues_count`, `default_branch` - came from direct `webfetch` calls to the GitHub REST API
(`https://api.github.com/repos/...`, plus `.../releases/latest` for release tags) on **2026-11-24**. Local file sizes
and code behaviour were read from this repository. No WER, latency, or memory figures were measured, and none are
asserted here.