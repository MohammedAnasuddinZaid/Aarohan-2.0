# AAC & Accessibility Research — CareSpeak

**Scope:** what to borrow from open-source AAC and eye-gaze projects, ranked into **adopt /
trial / reject**, plus the licensing rule that governs pictograms.

**Method note.** Web search was unavailable (HTTP 402). All repository facts come from the GitHub
REST API on **2026-11-24** (`license.spdx_id`, `stargazers_count`, `archived`, `pushed_at`,
`open_issues_count`). Nothing is estimated. Unverified items are marked `UNVERIFIED`.

---

## 0. What this repo actually is today (grounded, not claimed)

This matters before copying anyone's feature list: **CareSpeak is not an AAC board.** It is a
gesture-to-phrase alerting system with an unusually careful gaze stabilizer. There is no grid, no
symbol vocabulary, no sentence builder, no character keyboard.

| Capability | Where | Reality |
|---|---|---|
| Intent vocabulary | `src/types/index.ts` → `GESTURE_NAMES` | **6** intents: `YES, NO, HELP, WATER, HELLO, EMERGENCY`. Hand mode emits 4; eye mode emits 4 + blink-HELP + mouth-WATER. No free text. |
| Gaze input | `src/lib/eyeClassifier.ts` | Iris-offset classification relative to a learned neutral pose. **Not** screen-coordinate gaze — it cannot select an arbitrary UI target. |
| Calibration | `IrisCalibrator` (same file) | Automatic and silent: median + MAD over a rolling window of 140 samples, ~45 accepted frames to warm up, gated so a deliberate held gaze can't poison the baseline. **No user-facing calibration step, no progress indicator, no per-user persistence.** |
| Dwell / hold | `EyeGestureSmoother` | `HOLD_TIME_MS = 430` scales confidence with hold duration, `SMOOTHING_FRAMES = 9` majority vote. **Hardcoded, not user-adjustable, no visible dwell ring.** |
| Debounce | `GazeStabilizer` | Adaptive enter/exit bands from measured jitter (MAD-σ), glitch guard, 2-frame switch debounce, 130 ms post-blink refractory. This is genuinely good work — better than most hobby AAC repos. |
| Blink input | `EyeGestureSmoother` | Double blink within `DOUBLE_BLINK_WINDOW = 700 ms` → `HELP`, locked 2000 ms, `BLINK_COOLDOWN = 2000`. Single blink is *not* an input. |
| Pause | `src/app/eye-mode/page.tsx` copy | "Close eyes 5s to pause" (UI string; the timer itself lives in the hook). |
| Fatigue handling | `RESTING_THRESHOLD = 5` in `useEyeGesture.ts` / `useHandGesture.ts` | Repeated transitions raise the confidence gate to `0.85` (from `0.7`). **Silent** — the user is never told why it got harder. |
| Hand dwell | `PALM_HOLD_WATER_MS = 2000` in `src/hooks/useHandGesture.ts` | A held palm is a 2 s "dwell" for `WATER`. |
| Speech rate | `src/lib/tts.ts` → `TTSConfig.rate` (default `0.85`) | Persisted via `loadTTSConfig` / `saveTTSConfig`… **but `saveTTSConfig` is never called from any component** (verified by grep). There is no rate/pitch/volume control in the UI; the defaults always win. |
| Emergency | `src/app/emergency/page.tsx` | Dedicated page, 10 s countdown, triple siren (`voiceAlert.speak("EMERGENCY")` ×3 at 1200 ms spacing). Reachable **only** by navigating to `/emergency` (plus the navbar button). |
| Switch access | — | **None.** Every input requires a camera. |
| Predictive / frequent phrases | — | **None.** |
| Symbol assets | `public/` | **None.** Contents: `logo.png`, `hero-bg.jpg`, `hero-bg.mp4`, `icons/{icon-192,icon-512,icon.svg}`, `manifest.json`, `sw.js`, `worklets/*`. No pictograms. |
| Live announcements | `research/ACCESSIBILITY_AUDIT.md` | Documented gap: "No `aria-live` region for gesture announcements despite README claim." |

**Framing that follows from this table:** the highest-value work is not a new gaze algorithm. It
is *making the existing one legible and recoverable* — visible dwell, explicit calibration,
undo, adjustable timing — plus a non-camera fallback for people the camera cannot serve.

---

## 1. Repository metadata (fetched via GitHub REST API)

### 1.1 The four repos named for evaluation

| Repo | License (SPDX) | Stars | Forks | Archived | Last push | Open issues | Lang |
|---|---|---|---|---|---|---|---|
| `AventureStudio/iris` | **MIT** | 0 | 0 | false | 2026-06-23 | 0 | TypeScript |
| `altrudev/JelloOS` | **GPL-3.0** | 0 | 0 | false | 2026-10-23 | 5 | HTML |
| `revolutionarybukhari/ocula` | **MIT** | 2 | 2 | false | 2026-05-12 | 0 | HTML |
| `sproutaac/app` | **GPL-3.0** | 2 | 0 | false | 2026-11-07 | 26 | Dart |

> **Read this before borrowing anything.** `AventureStudio/iris` was created 2026-06-22 and last
> pushed 2026-06-23 — a one-day-old repository with 0 stars, 0 forks, 0 issues. Its description
> claims "browser-only, no API keys" but it has no track record. `JelloOS` and `sproutaac/app` are
> **GPL-3.0**: their code cannot be linked into a proprietary product without opening this
> codebase. Treat all four as *idea sources*, and `sproutaac/app` as the most thought-through of
> them (its stated design goal — "offline-first, privacy-safe, **motor-planning stable**" — is the
> correct instinct, see §2.1 item 11).

### 1.2 Top hits from GitHub repository search (`sort=stars`)

Query totals as returned: `augmentative and alternative communication` → **174** repos;
`AAC communication board` → **57**; `eye gaze keyboard` → **95**; `eye tracking AAC` → **24**.

| Repo | License | Stars | Forks | Archived | Last push | Open issues | Lang |
|---|---|---|---|---|---|---|---|
| `OptiKey/OptiKey` | **GPL-3.0** | 4432 | 510 | false | 2026-09-03 | 126 | C# |
| `cboard-org/cboard` | **GPL-3.0** | 770 | 299 | false | 2026-11-22 | 285 | JavaScript |
| `RonanOD/OpenAAC` | **Apache-2.0** | 34 | 5 | false | 2024-11-22 | 0 | Dart |
| `kbhujbal/Keyboard-Typing-with-Eyes` | **MIT** | 22 | — | false | 2025-04-14 | — | Python |
| `SpecialEffect/EyeMineMods` | **GPL-3.0** | 13 | — | false | 2026-11-08 | — | Java |
| `CambridgeIIS/KWickChat` | **NONE** | 13 | — | false | 2022-10-25 | — | Python |
| `Textualization/aac-llm` | **NONE** | 11 | — | false | 2024-01-30 | — | HTML |
| `sonicbaume/FreeAAC` | **AGPL-3.0** | 10 | 4 | false | 2026-10-28 | 22 | TypeScript |
| `TuriSc/voxease` | **MIT** | 8 | — | false | 2026-04-25 | — | HTML |
| `igoor-noprofit/igoor` | **AGPL-3.0** | 8 | — | false | 2026-10-27 | — | JavaScript |
| `itssarthak/eyeshift` | **MIT** | 5 | — | false | 2026-10-24 | — | Swift |
| `dkedzia/see-the-key` | **NONE** | 5 | — | false | 2026-02-24 | — | TypeScript |
| `juan-rey/SimonSays` | **OSL-3.0** | 2 | — | false | 2026-11-22 | — | C++ |
| `SubchiBeats/bol-sakhi-communication-board` | **MIT** | 1 | — | false | 2026-06-11 | — | JavaScript |
| `bhav-adhk30/als-eye-aac` | **NONE** | 1 | — | false | 2026-07-15 | — | Python |
| `UBayouski/GazeBoard` | **NONE** | 1 | — | false | 2026-11-18 | — | C# |

**License distribution is the story here.** Of the 16 search hits: 5 GPL/AGPL (copyleft — cannot
link into a closed product), 4 **NONE** (no license = all rights reserved, not legally reusable at
all), 4 MIT, 1 Apache-2.0, 1 OSL-3.0. Only `OpenAAC` (Apache-2.0) and the MIT-licensed ones are
directly safe to lift code from, and none of them is a drop-in for a Next.js/React app except
`voxease` and `bol-sakhi` (both HTML/JS, MIT).

A note on search quality: the combined query
`https://api.github.com/search/repositories?q=augmentative+communication+OR+eye+gaze+keyboard`
returned **`total_count: 0`** in this run. I therefore ran the four individual queries above and
report those. GitHub's relevance ranking also surfaced unrelated repos (a Minecraft mod, a
playlist file); they are excluded rather than "cleaned up", so the numbers stay honest.

---

## 2. Adopt / Trial / Reject

### 2.1 ADOPT — high confidence, low risk, addresses a documented gap

**1. A visible dwell ring with adjustable dwell time.**
Every mature gaze AAC system shows a filling indicator, because gaze selection without feedback is
a guessing game: users cannot tell a slow dwell from a failed one, so they dwell longer and
fatigue faster. Here `HOLD_TIME_MS = 430` already scales confidence with hold duration — the
signal exists, it is just invisible. *Where:* `src/app/eye-mode/page.tsx` (ring around the active
intent) + expose `400 / 600 / 900 / 1200 ms` presets. *Cost:* small. *Risk:* none.

**2. An explicit calibration ritual instead of silent auto-calibration.**
`IrisCalibrator` is well-built but invisible: it needs ~45 accepted frames, then silently stops
learning deliberate gazes. A user who is drifting (new chair height, new glasses, late-afternoon
light) has no way to know, and no way to restart. Adopt a 3-second "look at the dot" screen with
progress, a "recalibrate" button, and persist the neutral pose per user/device. Keep the
automatic baseline as the fallback — do not remove it. *Cost:* small–medium.

**3. Second-confirm on irreversible actions.**
The confirmation pattern already exists in the language pipeline design (see
`research/INDIAN_LANGUAGE_AI_RESEARCH.md` §2.7); the same must apply here. One stray dwell must
never dispatch `EMERGENCY` with a 10 s countdown, or send a medication message. Require a second
deliberate dwell, a longer hold, or the existing double-blink — and make "cancel" the easiest
target on screen. *Cost:* small.

**4. Switch access (single-switch scanning) as a first-class input mode.**
This is the most important missing capability in the whole product. Everyone who cannot use the
camera reliably — severe tremor, ptosis, nystagmus, one-eyed users, anyone in a dark room — is
currently locked out entirely. A 4–6 item auto-scanning board (scan rate adjustable, select by
blink, by a big switch, by keyboard `Space`, or by a caregiver tap) needs **no camera, no ML, no
model download** and reuses the existing intent vocabulary. It is the cheapest way to widen
coverage, and it works on the low-end Android devices the ward actually has. *Cost:* medium;
*highest* value-per-line in this document.

**5. A frequently-used-phrase board, ordered by recency and frequency (not by ML).**
AAC users repeat a small vocabulary far more than they compose novel sentences. Sort by
most-recent + most-frequent, let the caregiver seed ~5 phrases during setup (family names, "pain",
"toilet", "water", "too hot"), and never reorder mid-session — reordering after every use destroys
the spatial memory the user is building. Skip prediction initially; adopt only the static
MRU/frequency board. *Cost:* small–medium.

**6. The emergency phrase reachable from every patient surface.**
Today `EMERGENCY` requires navigating to `/emergency`. For an eye-only user, navigation *is* the
barrier. Put a persistent, large, always-visible emergency target on eye-mode and hand-mode
(corner placement, away from the gaze-control glyphs so it can't be hit by a look at the board),
with the same second-confirm rule as item 3 and the pre-authored multilingual strings from the
language doc. *Cost:* small.

**7. Adjustable speech rate / volume / dwell exposed in the UI.**
`TTSConfig` already carries `rate`, `pitch`, `volume` and persists them — but no component ever
calls `saveTTSConfig` (verified). Ship three presets ("slow / normal / fast") plus volume, stored
per user. This is a documented AAC requirement and it is currently a config field with no door.
*Cost:* very small. Do this first; it is nearly free.

**8. Undo / cancel window after dispatch.**
Dwell-based input produces accidental activations as a normal operating condition. A 3–5 s
"Sent — **Undo**" affordance after any patient→caregiver message is standard practice and costs
little. *Cost:* small.

**9. Non-silent queue behaviour in TTS.**
`src/lib/tts.ts` does `if (queue.length >= MAX_QUEUE) queue.shift()` — it silently discards the
**oldest** queued utterance. For a speaking user that is a dropped sentence; for an AAC user that
is their speech disappearing. Adopt: never drop silently — coalesce identical items, and surface
"2 messages queued" instead. *Cost:* small.

**10. Tell the user (and the caregiver) when fatigue handling kicks in.**
`RESTING_THRESHOLD = 5` raises the acceptance gate to `0.85` and the user experiences the system
"getting worse" with no explanation. Surface it: "Rest detected — selections need a longer look",
and notify the nurse console. Fatigue is a clinical signal, not an implementation detail.
*Cost:* small.

**11. Motor-planning-stable layout, frozen across languages.**
Borrowed as a *principle* from `sproutaac/app`'s stated design goal. Position must never change
when the UI language changes, when a phrase moves in the MRU list, or between sessions. Target
size and spacing stay constant. This is the single most under-rated AAC principle and it is
incompatible with "sort by frequency" done naively — resolve it by freezing positions and only
varying which *items* occupy them, never mid-session. *Cost:* design discipline.

**12. Respect reduced-motion and reduced-transparency in the dwell ring.**
The ring is the primary feedback channel; `prefers-reduced-motion` must not delete it. Swap
scale/rotation animations for a static opacity or numeric countdown. *Cost:* trivial.

### 2.2 TRIAL — plausible, needs measurement or a design decision first

**1. Word/phrase prediction from conversation history.** Evidence for AAC prediction is mixed and
highly user-dependent; gains concentrate in users with good literacy and stable vocabularies, and
prediction can *slow* motor-impaired users by moving targets. Trial behind a toggle with OFF as
default, and measure acceptance rate (accepted suggestions ÷ offered) per user. Do not ship an LLM
that rewrites the user's sentence — that is authorship, not assistance.

**2. Character-level gaze typing with prediction (OptiKey-style).** Large build (keyboard layout,
language model, per-character dwell). Only justified if users explicitly ask for open composition.
If trialled, borrow the *layout* ideas, not the GPL-3.0 code.

**3. Blink-only mode (single blink = select).** `EyeGestureSmoother` already measures blinks with
hysteresis (`BLINK_COOLDOWN = 2000`, 700 ms double-blink window) and uses only the double blink.
A single-blink mode with a longer debounce would serve users with very limited gaze range. Trial
carefully: blink detection is the least reliable signal at low frame rates.

**4. Clinician-configurable escalation thresholds.** `ESCALATION_RULES` in `src/types/index.ts`
hardcodes `help_frequency: 3 per 120 s`, `low_alertness: 25`, `prolonged_inactivity: 60 s`. These
are plausible defaults but not clinical consensus — expose them read-only in the nurse console
first, then make them configurable with an audit trail.

**5. Cross-language board switching that preserves position.** Users who switch language mid-
session (family speaks one language, nurse another) must not lose their place. Trial with the
frozen-layout rule from adopt item 11.

**6. Dwell-free "glance" selection for 2–4 very large targets.** Cheaper than full dwell for
yes/no, but prone to false positives; trial only for non-destructive intents.

### 2.3 REJECT — do not build, or do not claim

**1. Marketing webcam gaze as "eye tracking" or as medical-grade.** There is no IR illumination,
no head-pose compensation, no binocular calibration, and drift is real. `IrisCalibrator` is good
engineering, but it is **approximate gaze over a narrow intent space**, not a Tobii-class device.
Copy must say so. Reject any claim of equivalence — with clinicians, with procurement, and in
`README.md`.

**2. Single-dwell dispatch of anything high-stakes.** Rejected by construction (§2.1 item 3).

**3. Copying GPL-3.0 / AGPL-3.0 code into this codebase.** That excludes the two most mature
projects here: `OptiKey` (4432★, GPL-3.0) and `Cboard` (770★, GPL-3.0), plus `FreeAAC`
(AGPL-3.0), `JelloOS` (GPL-3.0) and `igoor` (AGPL-3.0). **AGPL is worse than GPL for a hosted web
app** — network use can trigger source-disclosure obligations. Read them for interaction patterns;
write your own code.

**4. Reusing code with no license.** `CambridgeIIS/KWickChat`, `Textualization/aac-llm`,
`dkedzia/see-the-key`, `UBayouski/GazeBoard`, `bhav-adhk30/als-eye-aac` have no license file. No
license means **all rights reserved** — not "free to use". Ideas only.

**5. LLM-generated symbol boards at runtime.** Unreviewable, culturally wrong for an Indian ward
context, inconsistent vocabulary across sessions (which breaks motor planning), and a licensing
minefield. Any board content must be authored and reviewed.

**6. Removing the English fallback in `tts.ts`.** It exists for a reason (`fallbackText`); a
patient hearing the wrong language beats a patient hearing nothing, provided it's labelled.

**7. Auto-switching the patient's language without consent.** Language is identity here. Detect,
suggest, never override.

**8. Treating star count as a safety signal.** The AAC space has high-star abandonware and
zero-star good ideas. `OptiKey` has 126 open issues; `cboard` has 285. None of these is a
maintained dependency you are adopting.

---

## 3. Pictograms and symbol sets — **a separate licence from code**

> **Explicit statement.** A repository's *code* licence says nothing about the *pictograms* it
> displays, bundles, or links to. Symbol sets are separately copyrighted works, usually with
> their own EULA, often with non-commercial or per-device restrictions, sometimes with trademark
> claims on the symbols themselves. **Symbol asset licences must be verified independently, in
> writing, before any commercial use or distribution** — and a permissive code licence on a
> project that happens to ship symbols does *not* extend to those symbols.
>
> **This repository has no symbol assets today.** `public/` contains only `logo.png`,
> `hero-bg.jpg`/`.mp4`, `icons/`, `manifest.json`, `sw.js` and the audio worklets. The first
> pictogram added is therefore a *licensing decision before it is a design decision*, and it can
> still be made cleanly.

| Symbol family | Commonly reported terms | Status here |
|---|---|---|
| ARASAAC | Free for non-commercial use, share-alike, attribution — **non-commercial is the blocker for a paid care product** | `UNVERIFIED` — must read the current terms |
| Mulberry Symbols | Free, share-alike, attribution | `UNVERIFIED` |
| Blissymbolics | Proprietary/trademarked system; commercial licensing required | `UNVERIFIED` — expect a paid licence |
| Boardmaker / PCS | Proprietary, licensed per seat/device; redistribution generally prohibited | `UNVERIFIED` |
| SymbolStix | Proprietary, subscription | `UNVERIFIED` |
| Widgit Symbols | Proprietary, licensed | `UNVERIFIED` |

**Recommended path (in order):**

1. **Author a minimal in-house set** for the 6 existing intents + ~30 core phrases. Vector, one
   visual style, reviewed by a speech-language therapist and by native speakers for cultural fit
   (the "water" glyph, the "pain" glyph and the "toilet" glyph are all culturally loaded).
   You own the assets outright; the licence question disappears.
2. If outsourcing, use a **CC0 / public-domain** set, and record the provenance file for every
   asset (`asset → source URL → licence → fetched date → file hash`).
3. If a clinically standard set is required (a therapist's existing board), **buy or license it**
   and keep it behind the licence terms — per-seat, no redistribution, no embedding in exported
   files.
4. **Never** scrape icons from another AAC app's build, and never assume that an app being free
   makes its symbols free.

**One trap worth naming:** `lucide-react` is already a dependency and is permissively licensed
(ISC), so it is tempting to use its icons as AAC symbols. Legally that is likely fine; **semantically
it is not** — general UI iconography is not an AAC symbol vocabulary (it is not designed for
single-glance disambiguation, nor clinically vetted, nor culturally localised). License-safe is
not the same as fit for purpose.

---

## 4. Interoperability (trial, with a caveat)

`Cboard` and `OpenAAC` are commonly described as using an open board-exchange format so a
therapist can move boards between tools. That would let a clinician bring an existing board
instead of rebuilding it — high value for adoption. **Specifics are `UNVERIFIED`**: I did not
confirm the format, its version, its schema, or its licence here. Before designing an importer,
verify the format and check whether importing a board drags in third-party symbols under
third-party terms (§3).

---

## 5. Claims to avoid (honesty gate)

- Do **not** call this "eye tracking" without qualification, and never "medical-grade".
- Do **not** claim WCAG 2.2 AA conformance — `research/ACCESSIBILITY_AUDIT.md` already flags the
  missing `aria-live` region, unverified contrast, and no screen-reader run.
- Do **not** claim AAC "coverage" until there is a board, a symbol set, and switch access. Today
  the vocabulary is **6 intents**.
- Do **not** describe the system as "hands-free" — it requires a camera, a face in frame, and
  moderate lighting.

---

## 6. UNVERIFIED — do not repeat as fact

- The real-world accuracy, false-activation rate, and per-user reliability of the iris-offset
  classifier. No measured study exists in this repo. **`UNVERIFIED`.**
- Whether 430 ms / 700 ms / 2000 ms constants suit any actual user population; they are reasoned
  defaults, not validated settings. **`UNVERIFIED`.**
- Every symbol-set licence term in §3. **`UNVERIFIED`** — read the source terms before use.
- The open board format's name, version and licence (§4). **`UNVERIFIED`.**
- The `sproutaac/app` claim of being "motor-planning stable" — that is its README's design goal,
  not an audited property. **`UNVERIFIED`.**
- Whether any of the listed projects is clinically validated or used in care settings. Stars and
  a licence are not evidence. **`UNVERIFIED` for all.**

---

## 7. Sources verified via GitHub API on 2026-11-24

```
# The four repos named for evaluation
curl -s https://api.github.com/repos/AventureStudio/iris
curl -s https://api.github.com/repos/altrudev/JelloOS
curl -s https://api.github.com/repos/revolutionarybukhari/ocula
curl -s https://api.github.com/repos/sproutaac/app

# Mature / notable projects confirmed individually
curl -s https://api.github.com/repos/OptiKey/OptiKey
curl -s https://api.github.com/repos/cboard-org/cboard
curl -s https://api.github.com/repos/RonanOD/OpenAAC
curl -s https://api.github.com/repos/sonicbaume/FreeAAC

# Repository search (sort=stars, order=desc, per_page=10)
curl -s "https://api.github.com/search/repositories?q=augmentative+and+alternative+communication&sort=stars&order=desc&per_page=10"
curl -s "https://api.github.com/search/repositories?q=AAC+communication+board&sort=stars&order=desc&per_page=10"
curl -s "https://api.github.com/search/repositories?q=eye+gaze+keyboard&sort=stars&order=desc&per_page=10"
curl -s "https://api.github.com/search/repositories?q=eye+tracking+AAC&sort=stars&order=desc&per_page=10"
# NOTE: the combined OR form returned total_count 0 in this run:
#   https://api.github.com/search/repositories?q=augmentative+communication+OR+eye+gaze+keyboard&sort=stars&per_page=20
```

Local grounding read (not modified): `src/lib/eyeClassifier.ts`, `src/hooks/useEyeGesture.ts`,
`src/hooks/useHandGesture.ts`, `src/app/eye-mode/page.tsx`, `src/app/emergency/page.tsx`,
`src/lib/tts.ts`, `src/types/index.ts`, `public/`, `package.json`,
`research/ACCESSIBILITY_AUDIT.md`.

**Sources verified via GitHub API on 2026-11-24.**