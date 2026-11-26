# Speech Model Comparison - ASR & TTS for CareSpeak / VoiceLink

Scope: on-device / local-only speech for an outbound+inbound care-calling agent, English + Indian English +
Hindi / Telugu / Tamil / Kannada / Malayalam, on Windows CPU with an optional CUDA path.

**Honesty contract for this document:** no model was run to produce any number here. Every cell that would
require a measurement says `UNVERIFIED`. The only measured quantities are **file sizes on disk**, which were
read from `backend/models/` in this repo. Repository-level facts (license, activity) come from the GitHub API
fetch recorded in `GITHUB_REPOSITORY_SHORTLIST.md`.

Web search was unavailable (HTTP 402), so no published WER/latency benchmark is cited - and none is invented.

---

## 1. Current baseline (what is deployed in this repo)

| Layer | Model / file | Size on disk | Languages | Runtime |
|---|---|---|---|---|
| ASR | `ggml-base.en.bin` (whisper.cpp) | 141.1 MB | English only | native `whisper-server.exe`, CPU or CUDA |
| VAD | `silero_vad.onnx` v5 | 2.2 MB | language-agnostic | onnxruntime CPU, 16 ms chunks |
| TTS | `vits-ljs.onnx` (VITS LJSpeech) | 108.8 MB | English only, 1 voice | `sherpa-onnx` OfflineTts, CPU |
| LLM | Ollama `qwen2.5:3b` | n/a (Ollama store) | multilingual | Ollama |

Unused-but-present assets: `kokoro model.onnx` 329.5 MB + `voices.bin` 5.5 MB; Piper voice
`en_US-libritts_r-medium.onnx` 74.9 MB.

Architectural constraints that matter more than model choice:

- ASR is **one HTTP request per finished utterance** (`/inference`), guarded by `asyncio.Semaphore(1)`.
  No partial hypotheses exist, so perceived latency = VAD end-of-speech (850 ms silence default)
  + full utterance transcription. Endpointing, not model speed, dominates the pause.
- TTS is **offline synthesis**, chunked by sentence in `StreamingTTSChunker`, generated under a thread lock.
  It is pseudo-streaming: first audio waits for the first complete sentence.
- The dependency set has **no PyTorch and no `transformers`**. Any Indic model below that needs them is a
  structural change, not a drop-in swap.

---

## 2. ASR comparison

### 2.1 Language coverage

| Option | English | Indian English | Hindi | Telugu | Tamil | Kannada | Malayalam |
|---|---|---|---|---|---|---|---|
| whisper.cpp `base.en` (current) | yes (checkpoint is `.en`) | UNVERIFIED (accent robustness unmeasured) | no (English-only checkpoint) | no | no | no | no |
| whisper.cpp multilingual (`ggml-base`/`small`) | yes | UNVERIFIED | claimed by Whisper's language list (`*`), quality UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| faster-whisper | yes (same weights) | UNVERIFIED | same as Whisper above | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| sherpa-onnx (streaming Zipformer / non-streaming) | yes (`zipformer-en-20M`, `parakeet-tdt-0.6b-v2-int8`, SenseVoice) | UNVERIFIED | **UNVERIFIED** - no Indic model in the README model tables | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| IndicConformerASR | **not listed** (no `en` monolingual model) -> UNVERIFIED | UNVERIFIED / code-mixed is the key risk | **yes** (`hi`, hybrid RNNT large) | **yes** (`te`) | **yes** (`ta`) | **yes** (`kn`) | **yes** (`ml`) |
| NVIDIA NeMo (as a runtime for the above) | yes, via separate English models | UNVERIFIED | inherits IndicConformer | inherits | inherits | inherits | inherits |
| AI4Bharat/vistaar | n/a - benchmark/training-set release, **not an inference engine** | n/a | n/a | n/a | n/a | n/a | n/a |

Reading of this table: **coverage is complementary, not overlapping.** whisper.cpp `base.en` owns English;
IndicConformer owns the five Indic languages; neither covers Hinglish/code-switched speech, which is exactly what
many Indian callers actually produce. That gap is the single biggest unknown in this comparison.

`IndicConformerASR` language list is verbatim from its README: 22 scheduled languages (`as, bn, brx, doi, gu, hi,
kn, kok, ks, mai, ml, mni, mr, ne, or, pa, sa, sat, sd, ta, te, ur`) plus one 600M `multi` hybrid-RNNT checkpoint.
No English entry appears in either table.

### 2.2 Engineering properties

| Option | Streaming / partials | Offline | CPU | GPU | Weights format | Adds PyTorch? | License |
|---|---|---|---|---|---|---|---|
| whisper.cpp (current) | no at the engine layer (utterance-per-request) | yes | yes (in use) | yes, CUDA binary present | GGML | no | MIT |
| faster-whisper | no (segment-level, after audio) | yes | yes | yes (CUDA) | CTranslate2 | no, but adds `ctranslate2` | MIT |
| sherpa-onnx streaming Zipformer | **yes**, token-level `OnlineRecognizer` | yes | yes | yes (provider switch) | ONNX | no | Apache-2.0 |
| IndicConformerASR | no (offline RNNT/CTC decode) | yes | yes, slow (assumed) | yes | `.nemo` (NeMo archive) | **yes** | MIT |
| NeMo | depends on model | yes | yes | yes | `.nemo` | **yes** | Apache-2.0 |
| Coqui/IndicF5-class stacks | n/a | yes | UNVERIFIED | expected | various | **yes** | see shortlist |

Published performance claims were **not** fetched (no search) and are **not** reproduced. No WER, RTF, TTFT,
or RSS figure in this document is measured.

### 2.3 Measured disk footprint only (not RAM)

| Option | Model size | Note |
|---|---|---|
| whisper.cpp `base.en` | 141.1 MB (measured) | on disk now |
| Kokoro 82M ONNX | 329.5 MB (measured) | TTS, listed for scale comparison |
| sherpa-onnx VITS LJSpeech | 108.8 MB (measured) | TTS, current |
| Piper voice (libritts_r medium) | 74.9 MB (measured) | TTS, unused |
| IndicConformer 600M `multi` | UNVERIFIED (not downloaded) | advertised as "600M" parameters in README; file size not measured |
| IndicConformer monolingual "large" | UNVERIFIED | not downloaded |

Runtime RAM for every option, including the current stack, is **UNVERIFIED**. Peak RSS on the target Windows
box should be recorded before committing to a second model in memory.

---

## 3. TTS comparison

Dimensions requested: naturalness, latency, offline capability, CPU-vs-GPU, plus licence and voice range
(which decide what is actually shippable).

| Option | Naturalness | Latency | Offline | CPU | GPU | Languages / voices | Licence | Verdict |
|---|---|---|---|---|---|---|---|---|
| **sherpa-onnx VITS LJSpeech** (current) | UNVERIFIED (subjective MOS never collected) | UNVERIFIED; per-sentence, run-to-completion under a lock | yes | yes (in production) | optional provider | English, **1 voice** (`sid=0`) | Apache-2.0 (model card) / Apache-2.0 code | retain as the safe default |
| **Kokoro 82M** | UNVERIFIED (widely described as strong for its size - not measured here) | UNVERIFIED | yes | yes (ONNX, int8/fp16/fp32 variants present) | optional | multi-voice, `voices.bin` ships 5.5 MB of voice packs; exact language list **UNVERIFIED** | Apache-2.0 | trial: highest naturalness-per-MB for English, already local |
| **Piper** (`rhasspy/piper` archived MIT; `OHF-Voice/piper1-gpl` maintained **GPL-3.0**) | UNVERIFIED | UNVERIFIED (historically positioned as low-latency; unmeasured) | yes | yes | optional | large voice catalogue; Indic voices **UNVERIFIED** | MIT (archived) / **GPL-3.0** (maintained) | reject for embedding; GPL-3.0 is a shipping risk |
| **IndicF5** | UNVERIFIED ("near-human" is the authors' claim) | UNVERIFIED; reference-audio conditioned, autoregressive-class model, expected slower than VITS on CPU - **unmeasured** | yes | UNVERIFIED, likely impractical | expected to be the intended path | **11 Indian languages**: Assamese, Bengali, Gujarati, Hindi, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu | **no LICENSE file, API `license: null`** | trial only after licence review |
| **coqui-ai/TTS** (incl. XTTS family) | UNVERIFIED | UNVERIFIED | yes | yes, heavy | yes | multilingual | code MPL-2.0; **per-model weight licences UNVERIFIED** | reject: stale repo (last push 2024-08-16), PyTorch stack |

Two facts worth stating plainly:

1. **The current TTS is a single English voice.** `vits-ljs.onnx` is LJSpeech - one female speaker, English.
   For Hindi/Telugu/Tamil/Kannada/Malayalam the product cannot speak at all today, so Indic TTS is not an
   optimisation, it is a missing capability.
2. **`tts.py` refuses any engine but `sherpa`** (`_load_sync` raises otherwise), so the Kokoro and Piper assets
   already in `backend/models/tts/` are dead weight until that branch is written. Anything recommended here
   needs a code change in `tts.py`, not just a file drop.

---

## 4. Recommendation for CareSpeak / VoiceLink

**Explicit caveat: this is an architecture direction, not a benchmark result. Nothing below has been measured on
target hardware, and every quality claim is UNVERIFIED. Treat it as a hypothesis list to be tested on-device
before any migration.**

Proposed shape - three lanes, one runtime each:

1. **Keep whisper.cpp for English (retain).** It is MIT, already shipping, CPU-and-CUDA binaries are checked in,
   and it introduces no Python ML dependency. Do not replace it with faster-whisper: same weights, extra runtime,
   no benefit at one-utterance-at-a-time concurrency.
2. **Add sherpa-onnx streaming Zipformer for English partials (adopt).** The dependency already exists for TTS and
   `sherpa-onnx==2.0.1` is pinned in `requirements.txt` (latest release is v2.0.3). Streaming ASR attacks the real
   latency problem - the 850 ms silence hang plus full-utterance decode - rather than shaving model time.
   This also removes the whisper.cpp HTTP subprocess as a single point of failure if it fully replaces it later.
3. **Add IndicConformer for the five Indic languages as an opt-in language mode (trial).** Monolingual
   `hi`/`te`/`ta`/`kn`/`ml` checkpoints exist and are MIT. Cost is real: `.nemo` + NeMo + PyTorch, so run it in a
   separate optional process rather than importing it into the FastAPI app, and keep it out of the default
   `requirements.txt`. Do **not** assume it handles English - its README lists no English model.
   `AI4Bharat/vistaar` is worth reading only for evaluation methodology, not for inference.
4. **TTS: keep sherpa VITS as the fallback, trial Kokoro for English naturalness, treat IndicF5 as an untested
   Indic option blocked on licensing.** Kokoro is the cheapest experiment in this whole document: Apache-2.0,
   82M parameters, files already in the repo, no new dependency. IndicF5 is the only realistic open Indic TTS
   here but has **no licence file at all** and requires reference prompt audio - resolve the licence before
   investing engineering time. Avoid embedding `piper1-gpl` (GPL-3.0) in a distributed product.

The honest summary: **the recommended direction is "stay on the two ONNX runtimes you already have, add streaming
for latency, and add one Indic model behind an opt-in flag"** - because it adds no new runtime for English and
quarantines the PyTorch dependency to a lane that needs it. Whether IndicConformer's accuracy justifies that
weight is **UNVERIFIED** and should be decided by the measurements below, not by this document.

### 4.1 Minimum measurement plan before committing

Run on the actual deployment box, with the actual telephony 8 kHz upsampled audio, and record raw numbers:

| Metric | How | Target to beat |
|---|---|---|
| WER per language | 50-100 real call utterances per language, hand-transcribed; Hindi/Telugu/Tamil/Kannada/Malayalam and English + Indian English separately | beat `ggml-base.en` on English; establish any baseline at all for Indic |
| Code-mixed WER | Hinglish utterances only | currently zero coverage - any non-crashing result is progress |
| End-of-speech to first transcript | timestamp VAD `speech_end` vs ASR response | current path: UNVERIFIED, measure first |
| First audio byte (TTS) | timestamp first sentence in vs first PCM chunk out, per engine | current path: UNVERIFIED |
| Peak RSS | whole process tree, all engines loaded | must fit the target box with Ollama resident |
| RTF | audio seconds / compute seconds | < 1.0 on CPU for real-time use |

Do this **before** changing `requirements.txt`, `tts.py`, or `asr.py`. No file outside `research/` was modified
in preparing this document, and no model was benchmarked.

---

## 5. Verification statement

- **Web search was unavailable (HTTP 402).** No search results, blog posts, or leaderboards informed this file.
- Repository facts (licence, activity, archive status) come from direct GitHub REST API calls on **2026-11-24**,
  catalogued in `GITHUB_REPOSITORY_SHORTLIST.md`.
- Language tables for IndicConformerASR and IndicF5 were read from their `README.md` files via the GitHub contents
  API, not from memory.
- Code behaviour was read from `backend/app/{asr,tts,vad,llm,engine}.py`, `backend/app/config.py`, and
  `backend/requirements.txt`.
- File sizes were measured on disk in `backend/models/`.
- **Every WER, latency, MOS, and RAM figure is marked `UNVERIFIED` because none was measured.**