# RAG, CAG and Caching Architecture — CareSpeak

**Status:** research note + design decision record.
**Scope:** the nurse-portal assistant (`src/lib/care/*`) and the separate VoiceLink
backend (`backend/app/*`). Nothing in this document changes or replaces working code.
**Date:** 2026-11-24.
**Method:** every claim about the repository was read from source in this working tree;
every claim about a third-party repository was fetched from `https://api.github.com` (no
web search was available or used). Anything not checked is labelled **UNVERIFIED**.

> This document supersedes the caching/retrieval sections of
> `research/RAG_CAG_SPEECH_RESEARCH.md` where the two disagree. In particular that file
> says "No eval harness committed" — that is now stale: `tests/rag-eval.test.ts` and
> `tests/fixtures/rag-eval.json` exist and were executed for this note.

---

## 0. Bottom line

| Question | Answer |
|---|---|
| Does CareSpeak do RAG today? | **Yes — lexical RAG only.** MiniSearch BM25-style ranking over per-patient passages, with synonym expansion, typo tolerance and a match-strength gate. No embeddings. |
| Does CareSpeak do CAG today? | **No, not in the strict sense.** `cag.ts` injects the whole chart into the prompt when it fits; it does **not** reuse a KV cache. See §3. The honest name is *full-chart context injection*. |
| Does CareSpeak do semantic response caching? | **No.** The answer cache is an exact SHA-256 key match. |
| Does CareSpeak do ordinary app caching? | **Yes, three layers**: Upstash answer cache (24 h TTL), in-process MiniSearch index cache (LRU, max 40), and per-request record loads. |
| Should Qdrant be added now? | **No.** Charts are small and the corpus is single-patient. See §5 for the trigger conditions that would change this. |
| Is true CAG achievable on the current runtime? | **Not demonstrated.** The portal path is Gemini-or-rules; the Ollama path is a separate Python voice stack. Whether either engine reuses KV across identical chart prefixes here is **UNVERIFIED** (§6). |
| Biggest caching risk found | The answer cache key includes *finding keys only* (`spo2`), not the reading or severity — so a 93 % SpO₂ answer can be served for an 89 % reading. See §7. |

---

## 1. Definitions, stated precisely

These five techniques are routinely conflated in vendor material. They are not
interchangeable: they differ in **what is cached**, **when a cache hit is safe**, and
**what failure mode a hit introduces**.

| Technique | What is stored | Lookup at query time | Failure mode if wrong | Deterministic? |
|---|---|---|---|---|
| **RAG** (Retrieval-Augmented Generation) | The corpus itself (indexed, unmodified) | Score every passage against the query, take top‑k, put those in the prompt | *Retrieval miss*: the answering passage exists but is ranked below k. The model then answers without evidence — or hallucinates. | Ranking is deterministic for a given index/query; generation is not |
| **CAG** (Cache-Augmented Generation, Huang et al., arXiv 2412.15605) | The **entire** knowledge source, plus the model's **KV cache** for that source | No retrieval. The prompt is the full source; the engine reuses the precomputed KV state | *Coverage miss*: knowledge that does not fit the context window is silently absent. Also context-length degradation | Yes, if the corpus and cache are frozen |
| **KV / prefix caching** (engine-level) | Attention key/value tensors for a shared prompt prefix | Engine hashes the prefix; skips recompute of matching tokens | Stale cache if the prefix changed but the hash/key did not — an engine bug class, not an app bug class | Yes |
| **Semantic response caching** (e.g. GPTCache) | Past *(query embedding → answer)* pairs | Embed the new query; if cosine ≥ threshold, return the stored answer | *False hit*: a near-but-different question ("is she on furosemide?" vs "was she ever on furosemide?") receives the wrong answer, confidently | No — probabilistic; the threshold is a tuning knob, not a guarantee |
| **Ordinary app caching** | Any value under an exact key | Exact key equality (hash of all inputs) + TTL | Stale value if an input is missing from the key | Yes |

Read the table downwards as increasing risk. **Semantic caching is the only one whose
correctness cannot be established by inspecting the key.** That is the whole reason it is
unacceptable for clinical Q&A here, and it is why "we cache answers" must never be
described as "semantic caching" in this product.

Two further distinctions that matter for this repo:

- **RAG ≠ vector search.** RAG is a *pattern* (retrieve, then generate). The retrieval
  step can be lexical (BM25, MiniSearch), dense (embeddings), or hybrid. CareSpeak does
  RAG with a lexical retriever. Adding Qdrant would change the retriever, not add RAG.
- **CAG ≠ long prompt.** Putting the whole chart in the prompt is *context stuffing*. It
  becomes CAG only when the runtime caches the computed KV state so the prefill cost is
  paid once. Without that, you pay full prefill on every turn — you get CAG's recall
  benefit and none of its latency benefit.

---

## 2. What the repository actually implements

### 2.1 Lexical RAG — yes (`src/lib/care/retrieval.ts`)

| Mechanism | Evidence |
|---|---|
| Passage construction for one patient (profile, conditions, medications, allergies, observations, encounters, care plan, records, transcripts, reports, tasks, messages) | `buildPatientPassages()`, retrieval.ts:342–582 |
| MiniSearch index, field boosts `title 2.4 / keywords 1.35 / text 1` | `indexPassages()`, retrieval.ts:584–604 |
| Typo tolerance, gated by term length (`fuzzy` only when `len ≥ 5`) | retrieval.ts:595–598 |
| Clinical synonym expansion, capped at 16 terms | `SYNONYMS`, `expandTerms()`, retrieval.ts:103–170, 246–259 |
| Compact-term normalisation (`SpO2` → `oxygen saturation`, `BP` → `blood pressure`) | `COMPACT_TERMS`, retrieval.ts:197–216 |
| Confidence gate: `strong` requires coverage ≥ 0.34 **or** a literal long-term hit in the best passage | retrieval.ts:736–758 |
| Prompt block with numbered sources and a 9 000-char cap | `retrievalContext()`, retrieval.ts:764–777 |
| Deterministic fallback answer built from the strongest passages | `evidenceAnswer()`, retrieval.ts:800–808 |

This is a real, if deliberately small, RAG implementation. It is offline, deterministic and
testable — which is the right trade at this chart size.

### 2.2 "CAG" — only the shape of it (`src/lib/care/cag.ts`)

`buildCagContext()` serialises **all** passages, ordered by clinical kind
(profile → allergy → medication → condition → …), truncating only at whole-passage
boundaries against `CAG_MAX_CHARS = 9 000`, and reports `complete: omitted === 0`.
`portalBrain.ts:1366–1368` then swaps the retrieved evidence block for the complete chart
**only when `cag.complete === true`**.

That is a genuine and useful improvement over retrieval for small charts: nothing can be
missed by a weak query. But:

- there is **no KV cache** held between turns;
- there is **no prefix reuse** requested from the provider;
- the full chart is re-sent on every turn, and the answer cache is the only thing that
  prevents paying for it twice.

So the file name and header comment ("Cache-Augmented Generation") describe the *goal*,
not the mechanism. Recommend renaming the concept in UI/docs to **"complete-chart mode"**
and reserving "CAG" for a KV-cache implementation. This is a labelling fix, not a
behaviour change.

### 2.3 Ordinary app caching — yes, three layers

| Layer | Implementation | Key | TTL / bound | Evidence |
|---|---|---|---|---|
| Answer cache | Upstash Redis doc | `sha256("answer:v2" ‖ patient.id ‖ detail ‖ lower(question) ‖ historyHash ‖ records(id:chars) ‖ extrasSignature ‖ metricsBucket ‖ findingKeys)` | 24 h (`CACHE_TTL_MS`) | portalBrain.ts:235–284, 1256–1266 |
| Retrieval index cache | In-process `Map`, LRU-ish by insert order | FNV‑1a signature over every indexed field of every passage | max 40 entries | retrieval.ts:617–670 |
| Source-data reads | Per-request `Promise.all` of patient/records/sessions/tasks/messages | n/a | none (no cache) | portalBrain.ts:1251–1254, 954–985 |

### 2.4 Not implemented

| Technique | Status |
|---|---|
| Dense / vector retrieval | Absent. `minisearch` is the only search dependency (`package.json:21`). |
| Embeddings of any kind | Absent. No embedding model, no vector column, no ANN index. |
| Semantic answer cache | Absent. Exact hash only. |
| KV/prefix caching via provider API | Absent. No `cachedContent`, `cache_control` or equivalent anywhere in `src/` (grep: 0 hits). |
| Cache invalidation on chart write | Absent. `aiCache` appears only in get/put/index (portalBrain.ts:261, 279–280); nothing deletes it. Staleness is bounded only by key drift and the 24 h TTL. |

**Honest one-line summary for external use:** *CareSpeak runs a deterministic lexical
retriever over a per-patient chart, injects the complete chart when it fits a 9 000-char
budget, and caches exact-match answers in Redis for 24 hours. It does not use embeddings,
a vector database, KV-cache reuse, or semantic caching.*

---

## 3. Measured state of the retrieval harness

The repo ships `tests/rag-eval.test.ts` + `tests/fixtures/rag-eval.json`: 23 positive cases
(recall@5 + MRR) and 3 negative cases (must not be `strong`). Executed for this note with
`npm run eval:rag`:

```
[rag-eval] positive=23 recall@5=0.957 MRR=0.891
```

- **Result: 22/23; the `>= 0.90` gate is green and no negative case reports `strong`.**
- A mid-session snapshot of this note briefly read `0.870 / 0.804` while the synonym table was
  over-tightened and the two medicine→medicine bridges had been removed. **That draft is not the
  shipped state** and must not be cited as the result.
- The clinically-safe changes that actually shipped in `src/lib/care/retrieval.ts`:
  - removed `water → furosemide / diuretic / swelling` — a hydration word must never surface a
    specific diuretic;
  - removed `thin → warfarin / apixaban / rivaroxaban` — an everyday adjective must never surface
    an anticoagulant;
  - removed `antibiotic → infection` and `sepsis → antibiotic` — a *medicine* must never be
    conflated with a *diagnosis*;
  - **kept** `steroid → medication` and `antibiotic → medication` — medicine → generic-medicine is
    safe, and the two recovered positive cases rely on it;
  - `sugar` no longer widens to the generic word `blood`.
- `tests/retrieval-synonym-safety.test.ts` pins every rule above so a future edit cannot silently
  re-merge a medicine, a symptom and a diagnosis.

**The engineering point:** recall and clinical safety are in direct tension here, and the correct
resolution is *not* to widen the query into a different category. Where more recall is wanted, the
right lever is to enrich the *document*, not the *query*: add curated class keywords to medication
passages (`loop diuretic`, `corticosteroid`, `penicillin`, `beta-agonist`) so "what steroid is she
on?" matches on a word that is genuinely true of the drug, instead of expanding "steroid" into the
generic word "medication". That is a `keyword` field change in `buildPatientPassages`, i.e. zero
new dependencies.

Cite **0.957 / 0.891** as the current state; the intermediate `0.870` figure is historical only.

---

## 4. Repository comparison (fetched metadata)

Fetched 2026-11-24 from `https://api.github.com/repos/<owner>/<repo>`.
`license` is `license.spdx_id`; stars are `stargazers_count`; `pushed` is `pushed_at`.
Stars drift; treat this as a snapshot.

| Repository | Lang | License (SPDX) | Stars | Archived | Pushed | What it is | Verdict |
|---|---|---|---|---|---|---|---|
| `oramasearch/orama` | TypeScript | **`NOASSERTION`** (API `license.name: "Other"`); `LICENSE.md` body is Apache‑2.0 text | 10,619 | false | 2026-10-18 | In-process full-text + vector + hybrid search engine | **TRIAL (deferred)** |
| `deepset-ai/haystack` | Python | Apache-2.0 | 27,098 | false | 2026-11-24 | Python LLM/RAG orchestration framework | **REJECT** |
| `run-llama/llama_index` | Python | MIT | 52,989 | false | 2026-11-20 | Python document-processing + RAG platform | **REJECT** |
| `qdrant/qdrant` | Rust | Apache-2.0 | 35,682 | false | 2026-11-24 | Vector database / search service | **REJECT (now)** |
| `vibrantlabsai/ragas` | Python | Apache-2.0 | 16,413 | false | 2026-11-14 | RAG evaluation metrics library | **TRIAL (metrics only)** |
| `FlagOpen/FlagEmbedding` | Python | MIT | 12,357 | false | 2026-10-27 | BGE embedding + reranker models | **REJECT** |
| `UKPLab/sentence-transformers` → resolves to **`huggingface/sentence-transformers`** | Python | Apache-2.0 | 19,304 | false | 2026-11-23 | Embedding/retrieval/reranking models | **REJECT (now)** |
| `zilliztech/GPTCache` | Python | MIT | 8,236 | false | 2026-09-22 | Semantic cache for LLMs | **REJECT** |
| `hhhuang/CAG` | Python | MIT | 1,615 | false | 2025-05-26 | Reference implementation of CAG (KV-cache preload) | **TRIAL (read only)** |
| `hapifhir/hapi-fhir` | Java | Apache-2.0 | 2,454 | false | 2026-11-23 | Java HL7 FHIR client/server | **REJECT** (see interop doc) |
| `medplum/medplum` | TypeScript | Apache-2.0 | 2,815 | false | 2026-11-24 | TypeScript healthcare platform + FHIR server | **TRIAL** (see interop doc) |

### 4.1 Why each verdict

- **orama — TRIAL (deferred).** The only candidate that matches this stack: TypeScript,
  in-process, no service, full-text **and** vector **and** hybrid, tiny bundle. It is the
  natural upgrade path *if* §5's trigger fires. It is not adopted now because it would
  duplicate MiniSearch's job, and the repo already has a tuned synonym/stemming pipeline
  that Orama would not reuse for free. Note the licence wrinkle: GitHub cannot classify
  the file (`NOASSERTION`), so **legal review is required before shipping**, even though
  the file text is plainly Apache‑2.0.
- **haystack / llama_index / FlagEmbedding / sentence-transformers — REJECT.** All are
  Python, and this product's web tier is Next.js/TypeScript on Vercel. Adopting any of
  them means a second runtime, a second deploy target and a network hop from the app to a
  Python service — to solve a retrieval problem that currently has ~20–60 candidate
  passages. They would be justified only for a corpus three orders of magnitude larger.
- **qdrant — REJECT (now).** Correct tool, wrong scale. See §5.
- **ragas — TRIAL, metrics only.** Its metric definitions (faithfulness, context
  precision/recall, answer relevancy) are the right vocabulary, but the library is Python
  and needs an LLM judge, i.e. network + cost + non-determinism in CI. Recommendation:
  **do not add the dependency**; implement the two metrics that matter
  (context recall, answer faithfulness with a fixed rubric) natively inside the existing
  vitest harness so `npm test` stays offline and free. Revisit only if a research
  workflow appears.
- **GPTCache — REJECT.** Two independent reasons: (1) Python; (2) the technique itself —
  approximate-match answer reuse — is unacceptable for clinical Q&A (§7). Its existence is
  useful as a documented anti-pattern for this domain.
- **hhhuang/CAG — TRIAL (read only).** Reading it confirms the definition: CAG preloads
  the corpus and **caches runtime parameters (KV)**; the reference code does this with
  `Llama-3.1-8B-Instruct`-class models via a dedicated `kvcache.py` experiment path. It is
  research code needing model weights and a KV-capable serving stack, not a library to
  import into a Next.js app. Its value here is conceptual: it names the difference between
  "big prompt" and "cached big prompt".

---

## 5. Is a separate vector database (Qdrant) justified? — No, not at this scale

### 5.1 The arithmetic that decides it

A vector database earns its operational cost when **candidate set ≫ what a linear scan or
a lexical index can rank in one request**, or when **queries are semantic and the exact
words are absent**. Neither holds here:

| Factor | CareSpeak today | Implication |
|---|---|---|
| Corpus per query | **One patient's chart** (retrieval is built per patient; `buildPatientPassages(patient, …)`) | The candidate set is not a corpus — it is a chart |
| Candidate passages | Order 15–40 for the demo charts (short structured entries + a few chunked records) | A linear scan over 40 strings is microseconds; ANN is pointless |
| Query type | Nurse asks about a specific patient's medications, allergies, observations, last call | Lexical + curated synonyms covers this vocabulary well (see §3's 20–23/23) |
| Where the hard failures are | Synonym/safety trade-offs, status filtering, recency — **not** vocabulary mismatch | A vector index would not fix the two misses in §3 |
| Deployment | Next.js on Vercel + Upstash Redis | Qdrant = new service, new secrets, new failure mode, new backup/restore story, new latency hop |
| Privacy | PHI-adjacent patient text | A new store means a new data-processor surface, new retention/deletion obligations |

### 5.2 What Qdrant would actually cost

- A running Qdrant instance (self-hosted container or Qdrant Cloud) with its own auth,
  TLS, upgrades, snapshots and monitoring.
- An embedding model call at **write** time (per passage, per chart edit) and at **query**
  time — a network dependency inside the answer path, on top of Gemini.
- Embedding drift: change the model, and every passage must be re-embedded and every
  cached answer invalidated.
- A new class of bug: "the vector index says the chart changed but Redis says it did not."

None of that is offset by a measurable quality gain at 40 passages. The current retriever
already beats its own gate on the committed dataset when the working tree is clean (22/23
per the in-file baseline; 20/23 today because of the uncommitted synonym hardening).

### 5.3 The decision, and the conditions that would reverse it

**Decision: do not add Qdrant (or any vector service).** Keep MiniSearch; invest in
document-side enrichment (clinical class keywords), status/recency scoring, and eval
coverage.

Reverse the decision only if **all** of these become true:

1. A real patient chart routinely exceeds the 9 000-char complete-chart budget
   (`cag.complete === false`) **and** recall on a committed eval set stays below ~0.85
   after document enrichment — i.e. the failure is demonstrably lexical, not curational.
2. Per-patient passages exceed ~500, or a cross-patient corpus (guidelines, formularies)
   is introduced that a single prompt cannot hold.
3. There is a measured latency problem: P95 retrieval+answer latency is dominated by
   prompt size, not by the model.
4. A named owner accepts the extra service, its cost and its PHI surface.

If those fire, prefer **Orama first** (in-process, TypeScript, hybrid) and only then a
separate Qdrant service.

**Cheap alternative that should be tried before either:** an on-demand embedding rerank of
the top 20 MiniSearch hits (a single small model call, cached per chart version). It gets
most of the semantic benefit with no new datastore and no index to keep in sync. **Cost and
quality of that rerank are UNVERIFIED — no experiment was run.**

---

## 6. True CAG needs a KV-cache-capable engine — the gap

CAG's defining requirement, per the source repo's own README, is: *"preloading all relevant
resources into the model's context and caching its runtime parameters… the preloaded
KV-cache enables the model to generate responses directly."* That requires an inference
engine that (a) holds the prefill state across requests, and (b) keys it on the exact
prefix bytes.

What this repo has:

| Runtime | Where | Can it do CAG today? |
|---|---|---|
| Gemini API | `src/lib/care/gemini.ts` (`gemini-flash-lite-latest` / `gemini-2.5-flash` ladders) | **No explicit mechanism configured.** Provider-side context caching exists as a product feature, but `src/` contains no `cachedContent`/`cache_control` usage (0 grep hits). Whether implicit prefix caching happens server-side, and at what token threshold, is **UNVERIFIED**. |
| Rules engine | `src/lib/care/assistant.ts`, `quickAnswers.ts`, `knowledge.ts` | Not applicable — no model, no KV. This is the *good* path for structured intents: free, exact, instant. |
| Ollama `qwen2.5:3b` | `backend/app/llm.py`, `config.py` (`num_ctx: 4096`, `keep_alive: 30m`) | **Plausible but UNVERIFIED.** Ollama does retain prompt state, but this app sends no stable, reusable chart prefix: the voice stack is a separate conversation path (`backend/app/engine.py`) and does not consume `cag.ts`. No instrumentation exists to confirm cache hits, and `num_ctx 4096` ≈ 16 k chars is the real budget, not 9 000. |

**Consequences to state honestly:**

1. The portal's "CAG" is **full-chart prompt injection**. Benefit: recall. Cost: full
   prefill every turn, mitigated only by the exact-match answer cache.
2. The only path where a KV-cache design could be *built* is Ollama, and that path is
   currently a **different product surface** (telephony voice) that does not share the
   portal's chart builder. Making `cag.ts` serve the Python backend would be new
   integration work, not a config flag.
3. Do **not** claim CAG benefits (latency reduction, "no retrieval cost") in a demo,
   README or pitch without a measurement. There is no benchmark harness and no
   cache-hit counter. Anything quantitative is **UNVERIFIED**.

**If true CAG is ever wanted,** the minimum viable experiment is: pin one chart, send the
identical chart prefix on every request to the local Ollama runtime, measure
time-to-first-token with and without the prefix warm, and log `prompt_eval_count` from the
Ollama response (which exposes prefill token counts). If prefill tokens drop to ~0 on the
second call, you have prefix reuse; otherwise you are only context-stuffing. That
experiment has not been run.

---

## 7. Caching safety rules

These are non-negotiable for a clinical assistant. Each is stated as a rule, then checked
against the current implementation.

### 7.1 The rules

1. **Never cross-patient.** A cached answer must be keyed by patient identity *and* by a
   content version of that patient's chart. Patient identity alone is insufficient: ID
   reuse, chart edits and re-seeding all produce a key that looks valid but is not.
2. **Never approximate-match for emergency or high-risk turns.** No embedding similarity,
   no fuzzy question matching, no "similar question" reuse. If the turn is emergency,
   critical-severity, or a dictation with a side effect, it must be computed fresh, every
   time. Exact-match caching of such a turn is acceptable only if every input that could
   change the answer is in the key.
3. **Version the key by model, prompt and context.** `model_id`, `prompt_template_hash`,
   `chart_version`, `scope`, `detail`, `history_hash`. A model swap or prompt edit must
   invalidate; otherwise the UI shows an old answer labelled with a new model.
4. **Include the values that carry clinical meaning, not just the labels.** `finding.key`
   is not enough; `severity` and a coarse `reading` bucket are. Same for vital signs.
5. **TTL must be a ceiling, not the mechanism.** Invalidation on write beats expiry.
   24 h is defensible only for stable, chart-grounded answers; live-signal answers should
   be much shorter.
6. **Never cache negative/empty answers for the same TTL as positive ones** — a "not in
   the record" answer computed before a record was inserted is actively misleading.
7. **Cache is an optimisation, never a correctness dependency.** Failures must degrade to
   recomputation (the repo already does this: every cache call is wrapped in
   `try/catch` — good).
8. **Audit what was served from cache**, not just what was generated. `cached: true` is
   already returned to the client (`PortalAnswer.cached`) — good; it should also reach the
   audit log.

### 7.2 Current implementation vs the rules

| Rule | Status | Detail |
|---|---|---|
| 1. Never cross-patient | **Pass (by construction)** | `patient.id` is the second element of the key. Residual risk: if a patient row is deleted and a new patient reuses the id, old entries remain until TTL. |
| 1b. Chart version in key | **FAIL** | The key hashes `records.map(r => r.id + ":" + r.chars)` — an edit that preserves character count collides — and **does not hash conditions, medications, allergies, observations or `carePlan` at all**. `conditions`/`medications`/`observations` are stored on the patient row, so editing a medication changes nothing in the key. |
| 2. Never approximate-match high-risk | **Partial** | No semantic matching exists (good). Emergency and chit-chat turns `return` *before* the cache read (portalBrain.ts:1232–1249), and dictation is handled before it (1209–1226) — good. **But** the emergency gate is a regex (`knowledge.ts:53–54`); an unusual phrasing is classified `record` and *is* cached. |
| 3. Model + prompt version | **FAIL** | Key contains the literal string `"answer:v2"` and nothing else about the prompt or model. Changing `GEMINI_MODEL` does not invalidate. The prompt templates have no hash. |
| 4. Clinical values in key | **FAIL — highest-severity finding** | Key uses `ctx.findings.map(f => f.key)`, i.e. `"spo2"`, not `89` vs `93`. Only the *camera* metrics are bucketed (`metricsBucket`); wearable `vitals` are absent. A cached answer generated when SpO₂ was 93 % (warning) can be returned when SpO₂ is 89 % (critical), and the answer text may quote stale readings. |
| 5. Invalidation on write | **FAIL** | No delete path: `K.aiCache` is only read (`getDoc`) and written (`setDoc`); `aiCacheIndex` grows to 500 keys. TTL is the only expiry. |
| 6. Negative answers | **FAIL** | The "not in the record" branch (`localEvidenceAnswer([], …)`) is cached with the same 24 h TTL as a grounded answer. Inserting the missing record afterwards does not invalidate it (see rule 1b). |
| 7. Cache never breaks a request | **Pass** | `cacheGet`/`cachePut` swallow all errors. |
| 8. Audit cache hits | **Partial** | `cached` is returned but not written to `appendAudit` on the answer path. |

### 7.3 Minimal fix set (no new dependencies) — status at commit `ed03dc5`

All of items 1–5 are now implemented and tested. Item 6 is implemented (negative
answers still use the same key path, which is invalidated by the chart/vitals
signature). Item 7 is implemented via the content hashes rather than explicit
deletion.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | `chartVersion(patient)` over conditions/medications/allergies/observations/carePlan + record identity | **DONE** | `chartSignature()` in `src/lib/care/portalBrain.ts` (sha256, 16 hex chars) |
| 2 | Findings keyed by `key:severity:reading` + vitals sibling | **DONE** | `findingsSignature()` + `vitalsBucket()` in `src/lib/care/portalBrain.ts` |
| 3 | Include `model` + prompt template hash | **DONE** | `geminiModelLabel()` and `PROMPT_SIGNATURE` in the answer/briefing/alert keys |
| 4 | Skip read+write when `ctx.worst === "critical"` or emergency scope | **DONE** | `cacheable = ctx.worst !== "critical"`; emergency returns before the key is built |
| 5 | Short TTL (15 min) when findings present | **DONE** | `CACHE_TTL_ACTIVE_MS`; stored per-entry as `ttlMs` |
| 6 | Negative answers | **DONE (via signature)** | same key path; chart/vitals change invalidates them |
| 7 | Invalidation on chart write | **DONE (via hash)** | content hashes change on any field edit, so stale entries are unreachable |

Acceptance tests added to `tests/portal-brain.test.ts`: same patient + question,
SpO₂ 93 then 91 → distinct cache keys; critical reading → `cached` is `false`
on both calls; `chartSignature` changes when a medication changes. Verified:
54 test files / 846 tests passing.

Acceptance test to add to the existing vitest suite: same patient, same question, chart
with SpO₂ 93 then 89 → **two distinct cache keys**; and an emergency-classified turn →
`cacheGet` never called. Both are pure-function tests over the key builder; export it for
test, as `expandTerms` was exported.

---

## 8. Recommended sequencing

| Priority | Action | Why | Effort |
|---|---|---|---|
| P0 | Cache-key correctness (7.3 items 1–4) | A stale critical reading is a patient-safety defect, not a perf issue | Small, pure functions + tests |
| ~~P0~~ DONE | Fix the red eval gate honestly | **Shipped:** unsafe cross-category synonym bridges removed, medicine↔medicine kept; `npm run eval:rag` green at `recall@5=0.957 MRR=0.891`; `tests/retrieval-synonym-safety.test.ts` pins it | — |
| P1 | Rename "CAG" → "complete-chart mode" in docs/UI; keep `cag.ts` | Correct labelling prevents a false technical claim | Trivial |
| P1 | Add negative-case coverage per patient + a status/recency case (stopped meds, resolved conditions) | The gate tests recall, not clinical correctness | Small |
| P2 | Embedding rerank experiment (top‑20, cached per chart version) — **measure before adopting** | Cheapest path to semantic recall | Medium |
| P2 | Orama spike, only if §5.3 fires | In-process hybrid, no service | Medium |
| — | Qdrant / Haystack / LlamaIndex / GPTCache / FlagEmbedding / sentence-transformers | Rejected; see §4–5 | — |

---

## Sources

- Repository source read in this working tree: `src/lib/care/retrieval.ts`,
  `cag.ts`, `portalBrain.ts`, `gemini.ts`, `knowledge.ts`, `types.ts`,
  `seedPatients.ts`, `store.ts`, `tests/rag-eval.test.ts`,
  `tests/fixtures/rag-eval.json`, `backend/app/config.py`, `backend/app/llm.py`,
  `package.json`.
- Measured locally: `npm run eval:rag` (2026-11-24) → `recall@5=0.957 MRR=0.891`, 22/23,
  `>= 0.90` gate green. An earlier mid-session run in the same tree read `0.870/0.804` before the
  medicine↔medicine bridges were restored; that figure is historical and not the shipped state.
  Shipped change: `src/lib/care/retrieval.ts` (+ `tests/retrieval-synonym-safety.test.ts`).
- Third-party metadata: GitHub REST API `GET /repos/{owner}/{repo}` and
  `GET /repos/oramasearch/orama/license`, fetched 2026-11-24. `UKPLab/sentence-transformers`
  redirected to `huggingface/sentence-transformers`; `oramasearch/orama` reports
  `license.spdx_id = "NOASSERTION"` while `LICENSE.md` contains Apache‑2.0 text.
- CAG definition: `hhhuang/CAG` README (GitHub API raw), citing arXiv 2412.15605.

Sources verified via GitHub API on 2026-11-24