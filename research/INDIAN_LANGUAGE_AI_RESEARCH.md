# Indian-Language AI Research — CareSpeak

**Scope:** what Indian-language AI open source can realistically power a patient ↔ caregiver
translation path in this repo, and how to do it without silently corrupting medication or
dosage language.

**Method note.** Web search was unavailable (HTTP 402). Every repository fact below comes from
the GitHub REST API (`api.github.com`) and, where marked, raw `README.md` files fetched from
`raw.githubusercontent.com` on **2026-11-24**. Numbers were not estimated. Anything I could not
verify is marked `UNVERIFIED` and must not be repeated as fact.

---

## 0. What this repository actually supports today (grounded, not claimed)

Read from source before writing recommendations. The gap between "11 languages on the landing
page" and "working multilingual speech" is large.

| Layer | File | Reality |
|---|---|---|
| UI strings | `src/lib/i18n.ts` | 10 languages (`en-US, hi-IN, bn-IN, ta-IN, te-IN, mr-IN, gu-IN, kn-IN, ml-IN, pa-IN`) × **43** `UIKey` entries. Hand-written, static. |
| Gesture phrases | `src/types/index.ts` (`SUPPORTED_LANGUAGES`, `LANGUAGE_DESCRIPTIONS`) | 10 languages × **7** phrases (`YES, NO, HELP, HELLO, WATER, EMERGENCY, SYSTEM`). Hand-written. |
| Whole-language count vs. India | — | 10 of the 22 scheduled languages. Missing from UI: Assamese, Odia, Urdu, Sanskrit, Kashmiri, Sindhi, Konkani, Manipuri, Nepali, Santali, Dogri, Maithili, Bodo. |
| Translation (MT) | — | **Does not exist.** No MT module, no engine, no API call, no `original`/`translated` fields. `NurseReply` is `{ id, text, lang, from, timestamp }` — one string, one language tag, no provenance. |
| Speech out (browser) | `src/lib/tts.ts` | `speechSynthesis` queue with a single-flight pump, `MAX_QUEUE = 4`, and an English `fallbackText` when no local voice exists. Remote TTS (gTTS URL) is **off** unless `NEXT_PUBLIC_CARE_REMOTE_TTS=1`, documented as a PHI risk. |
| Speech out (backend) | `backend/app/tts.py`, `backend/app/config.py` | Default `TTS_ENGINE=sherpa` → sherpa-onnx **VITS LJSpeech** (English). Optional Kokoro with default voice `af_heart` (English). **The backend TTS path is English-only in practice.** |
| Speech in | `backend/app/config.py` | `WHISPER_MODEL=.../ggml-base.en.bin`, `WHISPER_LANGUAGE=en` → **English-only ASR**. |

### Honest claim table

| Claim | Supported? |
|---|---|
| "UI available in 10 Indian languages" | **Yes** — verified static dictionaries. |
| "Speaks the patient's language" | **Conditionally** — only if the *device* has that `speechSynthesis` voice. Windows/Android frequently ship none for Indic languages; the code then speaks the English fallback. Per-device coverage `UNVERIFIED`. |
| "Understands Indian-language speech" | **No.** ASR model is English-only. |
| "Translates between languages" | **No.** Nothing implemented. |
| "Runs on-device / no data leaves" | True for browser TTS; incompatible with any cloud MT. If MT is added, this claim changes and needs a DPIA. |

**Consequence for design:** translation is a *greenfield addition*, not a patch. It must be
designed so that its absence still degrades gracefully (the app must work with zero MT engines).

---

## 1. Repository metadata (fetched via GitHub REST API)

### 1.1 The four repos under evaluation

| Repo | License (SPDX) | Stars | Forks | Archived | Last push | Open issues | Lang |
|---|---|---|---|---|---|---|---|
| `AI4Bharat/IndicTrans2` | **MIT** | 500 | 139 | false | 2025-10-03 | 17 | Python |
| `AI4Bharat/IndicConformerASR` | **MIT** | 108 | 14 | false | 2025-06-20 | 26 | (none / docs) |
| `AI4Bharat/IndicF5` | **NONE** | 159 | 75 | false | 2025-09-24 | 31 | Python |
| `AI4Bharat/vistaar` | **MIT** | 101 | 25 | false | 2025-06-08 | 13 | Python |

### 1.2 Other relevant AI4Bharat repositories (org listing, pages 1–2, 132 repos seen)

| Repo | License | Stars | Last push | Why it matters here |
|---|---|---|---|---|
| `Indic-TTS` | MIT | 421 | 2024-11-08 | Indic TTS training code — the missing piece behind the English-only backend. |
| `indicnlp_catalog` | NONE | 642 | 2024-12-14 | Index of Indic NLP resources; useful map, not reusable code. |
| `IndicXlit` | MIT | 148 | 2023-10-13 | Transliteration, 21 Indic languages — for romanized patient input ("dawa" → दवा). |
| `indicTrans` (v1) | MIT | 145 | 2024-01-02 | Superseded by IndicTrans2; 11 languages. Do not start here. |
| `IndicBERT` | MIT | 125 | 2025-04-06 | IndicBERT v2 — candidate for a cheap language-ID / intent pass. |
| `IndicWav2Vec` | MIT | 123 | 2025-08-28 | Self-supervised speech features; research-grade. |
| `IndicVoices-R` | **CC-BY-4.0** | 68 | 2024-12-11 | Dataset. **Code-license ≠ data-license example** (see §4). |
| `Indic-Glossaries` | MIT | 4 | 2023-01-27 | Glossary datasets for Indian languages — a real seed for the protected-terms list. |
| `Indic-Glossary-Explorer` | MIT | 7 | 2023-08-03 | Glossary service UI; shows the expected data shape. |
| `IndicLID` | NONE | 40 | 2025-12-02 | Language identification. No license → not reusable as-is. |
| `Indic-Swipe-v2` | MIT | 41 | 2026-07-13 | Kotlin swipe decoding for Indic scripts — relevant to motor-impaired text entry. |
| `indic-numtowords` | MIT | 23 | 2025-09-30 | **Number → words per language.** Needed to *speak* a protected dosage correctly. |
| `indic-punct` | MIT | 2 | 2023-12-16 | Spoken-form normalization / punctuation restoration. |
| `indic-transliterate-js` | MIT | 18 | 2024-09-12 | TypeScript/React transliteration — the only Indic AI artifact here that is drop-in for this stack. |
| `Chitralekha` | MIT | 118 | 2025-10-31 | Transcribe + translate + voiceover pipeline (reference architecture). |
| `Dhruva-Platform` | MIT | 25 | 2025-08-25 | Open model-serving platform (Bhashini's open core). |
| `indic-asr-api-backend` | MIT | 23 | 2024-07-19 | Indic-Conformer ASR service wrapper. |
| `IndicSUPERB` | Apache-2.0 | 17 | 2025-04-09 | Speech benchmark tasks. |
| `indicnlp_suite` | CC0-1.0 | 2 | 2024-01-01 | Natural-language-understanding resources. |
| `BhasaAnuvaad` | NONE | 31 | 2025-02-06 | Speech translation research; no license. |

**Two lookups returned 404** and are *not* what they appear to be:

- `AI4Bharat/IndicNLPSuite` → **404 Not Found**. The real repositories are `AI4Bharat/indicnlp_suite`
  (CC0-1.0, 2 stars) and `AI4Bharat/indicnlp_catalog` (NONE, 642 stars). Cite those names, not
  "IndicNLPSuite".
- `AI4Bharat/Bhashini-ULCA-API-specs` → **404 Not Found**. Bhashini/ULCA API specs are not
  published under the AI4Bharat org. Their licensing and endpoints are `UNVERIFIED`. The closest
  verifiable open artifacts are `Dhruva-Platform` (MIT) and `indic-asr-api-backend` (MIT).

### 1.3 Capability facts from the projects' own READMEs (fetched, not inferred)

| Fact | Source | Status |
|---|---|---|
| IndicTrans2 covers **all 22 scheduled Indic languages**, with script unification across Perso-Arabic, Ol Chiki, Meitei, Latin and Devanagari | IndicTrans2 `README.md` | Verified |
| IndicTrans2 **model checkpoints are MIT-licensed**, per its own license table (corpora are CC-BY-4.0; IN22 test sets CC-BY-4.0) | IndicTrans2 `README.md` → `## LICENSE` | Verified |
| IndicTrans2 ships `1B` base checkpoints and distilled `200M` (en↔indic) / `320M` (indic↔indic) variants; RoPE long-context variants handle up to 2048 tokens | IndicTrans2 `README.md` | Verified |
| IndicConformerASR targets **all 22 official Indian languages** and is **MIT** | IndicConformerASR `README.md` (`master`) | Verified |
| IndicF5 supports **11** languages (Assamese, Bengali, Gujarati, Hindi, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu), trained on 1417 h | IndicF5 `README.md` | Verified |
| IndicF5 has **no license file** (`license: null` from API) and its README has **no license section** | GitHub API + README | Verified negative |
| vistaar is MIT, and the README states the license "applies to all the fine-tuned language models" | vistaar `README.md` (`master`) | Verified |

> **Hard blocker:** `IndicF5` is the most attractive Indic TTS here, and it is the one you may
> **not** ship. No license = default all-rights-reserved. Do not put it in a commercial care
> product until AI4Bharat states terms. Treat audio from IndicF5 as `UNVERIFIED` for commercial
> use, and prefer `Indic-TTS` (MIT) or the existing sherpa/Kokoro English path meanwhile.

---

## 2. Proposed patient ↔ caregiver translation pipeline

Design goal: **translation is an annotation layer on top of an immutable original message.**
The original is never rewritten, never overwritten, never dropped. If every MT component fails,
the app still delivers the original text with a language tag and an explicit "not translated"
marker.

### 2.1 Non-negotiable invariants

1. **Original is immutable.** Stored once, at creation, with its own language tag and its own
   hash. All later text is an additional record.
2. **Both texts are always retrievable.** The UI may collapse, never delete.
3. **Machine translation is always labelled.** Every MT string carries `engine`, `modelVersion`,
   `confidence`, `at`, and `reviewed: false` until a human signs off.
4. **Medication/dosage text is never machine-mutated.** Numbers, units, drug names and schedules
   are removed before MT and restored byte-for-byte after.
5. **Low confidence never silently downgrades to English.** It escalates to a human or blocks.
6. **Emergency phrases are never MT-generated at runtime.** They are pre-authored and reviewed (§3).

### 2.2 Data model (additive; today's `NurseReply` has a single `text`)

```ts
// src/lib/i18n/types.ts (proposed — additive, nothing in src/ is modified by this doc)
type LangTag = string; // BCP-47 for UI, e.g. "hi-IN"

interface OriginalText {
  text: string;        // exactly as typed/spoken — never normalized for storage
  lang: LangTag;       // author's language
  source: "patient" | "caregiver" | "system";
  sha256: string;      // integrity anchor
  at: number;
}

interface Translation {
  text: string;
  lang: LangTag;
  engine: "indictrans2" | "human" | "phrasebook" | "none";
  modelVersion?: string;      // e.g. "indictrans2-indic-en-dist-200M"
  confidence?: number;        // 0..1, engine-specific, see §2.5
  protectedTerms: ProtectedTermHit[];  // must round-trip exactly
  reviewed: boolean;          // false = machine output, never claim otherwise
  reviewer?: string;
  at: number;
}

interface BilingualMessage {
  id: string;
  original: OriginalText;      // required, immutable
  translations: Translation[]; // zero or more; [] is legal and means "untranslated"
}
```

`NurseReply` then becomes `{ id, from, timestamp, original, translations }`. Existing consumers
that read `.text` keep working via a derived `primaryText()` helper that prefers the reader's
language and falls back to `original.text` — never to a different meaning.

### 2.3 Pipeline stages

```
capture ─► language detect ─► protect ─► translate ─► verify ─► tier ─► present/confirm ─► audit
                              (mask)                  (restore)            (badge)
```

1. **Capture.** Free text, a chosen phrasebook entry, or ASR output. Stamp `lang` from the UI
   language, overridden by `IndicLID`/`IndicBERT` only when the text is long enough to be sure
   (short AAC utterances are too ambiguous — do not auto-detect on ≤ 6 tokens).
2. **Language detect / normalize.** Detect script run; if romanized Indic, offer `IndicXlit`
   transliteration *as a suggestion the user accepts* — never silently rewrite their words.
3. **Protect (§2.4).** Mask every protected span with sentinels (`⟦P1⟧`, `⟦P2⟧`…) that IndicTrans2's
   SentencePiece vocabulary will not merge into surrounding text. Keep a span map in memory for
   this request only.
4. **Translate.** IndicTrans2 (`indic-en` / `en-indic` / `indic-indic`), target-tagged. Batch and
   cache by `(sha256(original), targetLang, modelVersion)` so repeated phrases cost nothing and
   are *stable* across turns.
5. **Verify.** (a) every sentinel survives, in order — otherwise the result is rejected outright;
   (b) length ratio sanity (translated/original characters within a wide band per language pair —
   a wild ratio means truncation); (c) optional back-translation check, `trial` only (§2.5).
6. **Tier + present.** Green/amber/red (§2.5). Amber and red attach the MT badge and, for
   medication content, the confirmation card (§2.7).
7. **Audit.** Append `{ messageId, originalHash, targetLang, engine, modelVersion, confidence,
   tier, reviewer }` to the existing audit trail. Never store the mask map.

Reference implementation home: `src/lib/i18n/translate.ts` (pure functions) +
`src/app/api/care/translate/route.ts` (engine call, rate-limited, PHI-minimizing). The queue
discipline already used in `src/lib/tts.ts` (single-flight, bounded queue, epoch-based cancel) is
the right pattern to copy — a translation must be cancellable the moment the patient changes
their mind.

### 2.4 Protected-terms list (the part that must not be left to a model)

Three classes, all masked before MT and restored verbatim:

**A. Numeric and measurement spans** — masked, never translated as digits.

```ts
const NUMERIC = [
  /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|g|ml|mL|L|IU|units?|mmol|mEq|%|mg\/kg|mcg\/kg|mmHg|bpm|°C|°F)\b/gi,
  /\b\d+\s?(?:\/\s?\d+)\b/g,                 // 120/80, 1/2 tablet
  /\b(?:half|quarter|one|two|three)\s+(?:tablet|dose|puff|drop)s?\b/gi,
  /\b\d{1,2}[:.]\d{2}\s?(?:am|pm|hrs?)?\b/gi, // times
  /\b\d{1,2}\s?(?:am|pm)\b/gi,
];
```

**B. Drug / route / frequency vocabulary** — masked via a curated bilingual glossary, *not* MT.
Seed the glossary from `AI4Bharat/Indic-Glossaries` (MIT, verified) plus clinician sign-off; store
as `{ en: "paracetamol", hi: "पैरासिटामोल", ta: "பாராசிட்டமால்", …, approvedBy, approvedAt }`.
Also block: `OD, BD, TDS, QID, PRN, STAT, HS, AC, PC, PO, IV, IM, SC, SL, NPO, PR, NG, PEG`.

**C. Identifiers and names** — patient name, room/bed, MRN, phone, doctor name, allergy names.

**Restoration rule:** sentinels are re-inserted in order; a count or order mismatch is a
**hard failure** → tier red → original only. Never "best effort" a sentinel.

**Spoken form is a second, separate step.** The digits must *stay digits* in text, but must be
pronounced in the target language: `5 mg` → `पाँच मिलीग्राम`, via `indic-numtowords` (MIT) before
TTS. This is where a naive pipeline sounds like a foreigner reading a chart — and where a wrong
unit reading becomes dangerous. Keep the number, change only its spoken representation, and log
the spoken string alongside the audio.

### 2.5 Confidence tiers and safe fallback

| Tier | Condition | Behaviour |
|---|---|---|
| **Green** | No protected terms, engine confidence ≥ `T_GREEN`, sentinels intact (or none) | Show translation with a quiet "auto" tag; original one tap away. |
| **Amber** | Engine confidence in `[T_AMBER, T_GREEN)`, **or** any protected term present, **or** untranslated word ratio high | Show original **first**, translation below, visible `⚠ Machine-translated — verify` badge. Medication content additionally requires §2.7 confirmation. |
| **Red** | Confidence < `T_AMBER`, sentinel failure, engine timeout/error, unsupported pair | **Do not show a translation.** Deliver `original` + `lang` + "Needs interpreter" flag; speak the fixed bilingual safety sentence; queue for the nurse console. |

Thresholds are **calibration work, not constants to guess.** Start with `T_GREEN = 0.85`,
`T_AMBER = 0.60` only as a placeholder, then set them against a held-out set of *your own* AAC
phrases and medication lines. Any specific number quoted as "IndicTrans2's accuracy on clinical
text" would be fabricated — **no such benchmark exists in this repo or in the fetched material
(`UNVERIFIED`)**.

**Fallback ladder (must terminate, never loop):**

```
engine A (self-hosted IndicTrans2) → engine B (human-reviewed phrasebook match)
→ original + interpreter flag → human on the nurse console
```

Never: MT into English and call it done. Never: retry the same failing request in a loop under
an emergency countdown.

**Back-translation checking** is attractive and expensive (2× cost, and back-translation can be
confidently wrong). Trial it offline on the phrasebook only; do not gate live traffic on it.

### 2.6 Presenting both texts

- Caregiver view: original in the patient's script at full size, translation directly beneath in
  the caregiver's language, MT badge on the translation, never on the original.
- Patient view: their own words on top (they must recognise what they "said"), caregiver reply
  below. For a patient who cannot read, TTS reads the *patient's* language version and the
  screen shows the caregiver's original — the audio and the visual need not match, but each must
  be labelled.
- A single "show original only" switch, persisted, for users who find dual text confusing.
- Nothing is auto-collapsed for content containing a protected term.

### 2.7 The confirmation step (medication and irreversible actions)

Triggered by: any Class-A/B protected term, any red/amber translation, or an explicit
"medication" intent. The card shows, side by side:

```
ORIGINAL (as written)          TRANSLATION (machine)            TERMS (verbatim, unchanged)
"Paracetamol 500 mg PO BD"     "पैरासिटामोल 500 mg मुँह से दिन में दो बार"
                               ⚠ Machine-translated  |  500 mg · PO · BD   ✓ all preserved
```

Actions: **[Send as written]** · **[Edit]** · **[Request interpreter]** · **[Cancel]**.
"Send as written" requires a second, deliberate confirm (press-and-hold, or the existing
double-dwell pattern from `src/app/eye-mode/page.tsx`) — one stray dwell must never dispatch a
dose. Record who confirmed, which terms were reviewed, and the engine version.

For the patient speaking *to* the caregiver, the mirror rule applies: a patient's report of a
symptom goes out as original + translation, so a mis-translation is visible rather than
authoritative.

### 2.8 Privacy and the on-device claim

IndicTrans2-distilled 200M is the only variant with a plausible self-host story, but running it
inside a Next.js route on Vercel will not work — it is a Python/PyTorch model. Two honest shapes:

- **Self-hosted sidecar** (matches `backend/`): FastAPI + `IndicTrans2` distilled, localhost on the
  ward machine, no PHI egress. Consistent with `SECURITY.md` and `ZERO_COST_POLICY.md`.
- **Cloud API** (Bhashini/ULCA or a hosted model): every message is PHI leaving the device. This
  contradicts the current "on-device" story in `src/lib/tts.ts` and needs a DPIA + processor
  agreement before code.

If neither is available, the correct behaviour is tier red — original plus interpreter flag. That
is a *feature*, not a failure.

### 2.9 Language-code mapping (a real integration bug waiting to happen)

IndicTrans2 uses ISO-639-3 + script (`hin_Deva`, `tam_Taml`, `ben_Beng`); the app uses BCP-47
(`hi-IN`). Both exist for the 10 UI languages, but the mapping must be explicit, and the 12
scheduled languages with **no** UI support must be rejected at the boundary rather than silently
translated into a language the patient cannot read.

```ts
const INDICTRANS2_TAG: Record<string, string> = {
  "hi-IN": "hin_Deva", "bn-IN": "ben_Beng", "ta-IN": "tam_Taml", "te-IN": "tel_Telu",
  "mr-IN": "mar_Deva", "gu-IN": "guj_Gujr", "kn-IN": "kan_Knda", "ml-IN": "mal_Mlym",
  "pa-IN": "pan_Guru", "en-US": "eng_Latn",
};
```

Pairs outside this map (e.g. a Marathi patient ↔ a Bengali caregiver is fine; a Santali patient is
not) return tier red. Adding Odia/Assamese/Urdu later is a **two-part** change: dictionary *and*
tag map, together.

---

## 3. Should common AAC phrases be pre-translated / pre-generated?

**Yes for the closed set. No for free text. And "pre-translated" must mean "hand-authored and
reviewed", not "MT output pasted once".**

### Why yes for the closed set

- **Latency is a communication right.** The whole gesture path is designed for sub-second
  response — `HOLD_TIME_MS = 430` in `src/lib/eyeClassifier.ts`, a 2 s palm hold in
  `src/hooks/useHandGesture.ts`. A network MT round trip on "I need help" destroys turn-taking
  for the exact users who have the fewest alternatives.
- **These strings are short, fixed and high-risk.** Machine translation is weakest exactly here:
  3-word utterances have no context, and the consequences of a wrong "No" are asymmetric.
- **Review is possible.** A clinician plus a native speaker can sign off ~100 strings once. Nobody
  can sign off an unbounded stream of novel patient sentences.
- **Offline is a requirement, not a nice-to-have.** `public/sw.js` already caches; a phrasebook in
  the bundle works on a ward with no uplink.
- **Determinism.** The same glyph must produce the same words every time, or the patient cannot
  build the motor memory that AAC users depend on.

### What belongs in the closed set

1. The 7 existing `LANGUAGE_DESCRIPTIONS` entries × 10 languages (already live — audit, don't
   rewrite).
2. The 6 emergency strings and the emergency page copy (`src/app/emergency/page.tsx`).
3. Pain scale utterances (0–10, "the nurse has been informed") — digits protected, spoken via
   `indic-numtowords`.
4. A small extended board (~30–60): "I need the toilet", "I am in pain", "too hot/cold",
   "call my family", "I don't understand", "please repeat", "yes/no/more/stop/finished",
   "thank you".
5. Caregiver→patient replies of the same shape: "I'm coming", "please wait", "the doctor has been
   informed", "well done".

### Why no for free text

You cannot pre-generate an open set, and pretending the phrasebook covers it is how AAC systems
become unusable ("I can only say what someone predicted I'd want to say"). Free text goes through
§2.3 with the MT badge.

### Provenance requirements for every pre-translated string

```ts
interface PhrasebookEntry {
  id: string;                       // stable — motor memory depends on it
  semanticKey: string;              // groups translations of the same intent
  lang: LangTag;
  text: string;
  audioCacheKey?: string;           // optional pre-rendered audio, if a licensed voice exists
  reviewed: true;                   // phrasebook entries are reviewed BY DEFINITION
  reviewers: string[];             // clinician + native speaker
  approvedAt: string;
  source: "authored" | "mt-then-edited";
}
```

Rules: never silently edit an approved string (bump a version, keep the old one); keep the
semantic key stable so a board layout survives translation changes; do not pre-generate *audio*
with any engine whose license is unclear — **IndicF5 audio is blocked today (no license)**. Cached
browser-voice audio is device-bound and cannot ship in the bundle.

---

## 4. License reality check (code ≠ weights ≠ data)

| Artifact | Verified license | Commercial use |
|---|---|---|
| IndicTrans2 code + **model checkpoints** | MIT (README license table) | Yes, with attribution. |
| IndicTrans2 corpora (BPCC), IN22 test sets | CC-BY-4.0 | Yes, with attribution — **separate obligation from the code**. |
| IndicConformerASR | MIT | Yes. |
| Indic-TTS | MIT | Yes. |
| `indic-numtowords`, `indic-punct`, `IndicXlit`, `indic-transliterate-js` | MIT | Yes. |
| vistaar | MIT ("applies to the fine-tuned language models") | Yes for models; **dataset terms are a separate question — `UNVERIFIED`.** |
| **IndicF5** | **NONE** | **No. Treat as all-rights-reserved until AI4Bharat publishes terms.** |
| IndicLID, BhasaAnuvaad, `indicnlp_catalog` | NONE | No (catalog is a *map*, not code). |
| IndicVoices-R | CC-BY-4.0 (dataset) | Yes with attribution; it is data, not a library to link. |

Practical rule for this repo: **a permissive repo license does not license its downloaded
weights, its voice, or its pictograms.** Three separate auditable rows per component.

---

## 5. UNVERIFIED — do not repeat as fact

- Per-device availability of `speechSynthesis` voices for the 10 Indic languages. The code has an
  English fallback precisely *because* coverage is unknown; there is no instrumentation counting
  fallbacks. **`UNVERIFIED`.**
- Any accuracy/BLEU/COMET number for IndicTrans2 on clinical, AAC, or medication text. **No such
  evaluation exists in this repo. `UNVERIFIED` — do not quote one.**
- Whether self-hosted IndicTrans2-distilled 200M is fast enough on ward hardware for interactive
  use. **`UNVERIFIED`** (needs a measured latency test on target CPU).
- Bhashini/ULCA API licensing, quota, data-retention and PHI terms. Specs repo 404'd. **`UNVERIFIED`.**
- Whether AI4Bharat will license IndicF5 for commercial use. **Unknown; no license file.**
- Whether IndicTrans2 model weights are lawfully distributable *for clinical use* even under MIT —
  MIT grants copyright permission, not a medical-device authorization. **Regulatory status
  `UNVERIFIED`; not a license question.**
- Quality of IndicTrans2 on the 10 UI languages specifically vs. the 22-language average.
  **`UNVERIFIED`** — per-language quality varies and was not measured here.

---

## 6. Sources verified via GitHub API on 2026-11-24

Endpoints queried (GitHub REST API v3, `Accept: application/vnd.github+json`), plus the raw
README fetches used for the capability/license claims in §1.3.

```
# Repo metadata (license.spdx_id, stargazers_count, archived, pushed_at, open_issues_count)
curl -s https://api.github.com/repos/AI4Bharat/IndicTrans2
curl -s https://api.github.com/repos/AI4Bharat/IndicConformerASR
curl -s https://api.github.com/repos/AI4Bharat/IndicF5
curl -s https://api.github.com/repos/AI4Bharat/vistaar
curl -s https://api.github.com/repos/AI4Bharat/indicTrans
curl -s https://api.github.com/repos/AI4Bharat/IndicNLPSuite        # 404 Not Found
curl -s https://api.github.com/repos/AI4Bharat/Bhashini-ULCA-API-specs  # 404 Not Found
curl -s https://api.github.com/repos/AI4Bharat/IndicWav2Vec
curl -s https://api.github.com/repos/AI4Bharat/Indic-TTS
curl -s https://api.github.com/repos/AI4Bharat/IndicBERT
curl -s https://api.github.com/repos/AI4Bharat/IndicXlit
curl -s https://api.github.com/repos/AI4Bharat/indic-numtowords
curl -s https://api.github.com/repos/AI4Bharat/IndicLID
curl -s https://api.github.com/repos/AI4Bharat/IndicVoices-R
curl -s https://api.github.com/repos/AI4Bharat/Dhruva-Platform

# Org listing (132 repos across two pages)
curl -s "https://api.github.com/orgs/AI4Bharat/repos?per_page=100&sort=stars&direction=desc"
curl -s "https://api.github.com/orgs/AI4Bharat/repos?per_page=100&page=2&sort=stars&direction=desc"

# Capability + license text (README raw)
curl -s https://raw.githubusercontent.com/AI4Bharat/IndicTrans2/main/README.md
curl -s https://raw.githubusercontent.com/AI4Bharat/IndicF5/main/README.md
curl -s https://raw.githubusercontent.com/AI4Bharat/IndicConformerASR/master/README.md
curl -s https://raw.githubusercontent.com/AI4Bharat/vistaar/master/README.md
```

Local grounding read (not modified): `src/lib/i18n.ts`, `src/lib/tts.ts`, `src/types/index.ts`,
`src/app/eye-mode/page.tsx`, `src/lib/eyeClassifier.ts`, `src/hooks/useHandGesture.ts`,
`backend/app/tts.py`, `backend/app/config.py`.

**Sources verified via GitHub API on 2026-11-24.**