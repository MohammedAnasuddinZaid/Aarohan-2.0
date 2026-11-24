# Final Report — CareSpeak / Aarohan 2.0

Status at `origin/main` = `56b60db` (verified via `git ls-remote`).
Synthetic data only; no clinical validation or compliance claim is made.

## 1. Implemented + verified

| Area | What shipped | Evidence |
|---|---|---|
| Security mode | `CARE_SECURITY_MODE=demo|strict`; strict default on Vercel (`VERCEL` set); `CARE_DEMO_MODE=0` alias | `src/lib/care/securityMode.ts`, `tests/security-mode.test.ts` |
| `/api/notify` | Proof required when MSG91 configured or strict mode; demo stays open keyless | `src/app/api/notify/route.ts`, tests |
| Sync/stream data plane | Read + write require proof in strict mode; demo open by design | `src/app/api/sync`, `src/app/api/stream` |
| QR pairing | Rotate requires proof of current token; register returns 409 on conflict; nurse reclaim; per-IP throttle | `src/lib/server/pairing.ts`, `src/app/api/pair`, tests |
| Device token | Constant-time compare | `src/lib/care/auth.ts` |
| Service worker | v3, never caches authenticated/PHI pages; prior bad caches purged | `public/sw.js`, `tests/service-worker-privacy.test.ts` |
| Answer cache | Keys include full chart + vitals + finding severity/reading + model + prompt hash; active findings TTL 15 min; critical readings bypass cache | `src/lib/care/portalBrain.ts`, `chartSignature`, `extrasSignature` |
| Prompt versioning + injection guard | Cache invalidated on prompt version bump; guard on user input | `src/lib/care/portalBrain.ts` |
| Retrieval safety | Synonym/compact-term tables; medicines vs symptoms vs diagnosis not conflated; eval gate green | `src/lib/care/retrieval.ts`, `tests/retrieval-synonym-safety.test.ts` |
| AAC phrase library | English-only except gesture-mapped; non-localised phrases show EN badge | `src/lib/care/aacPhrases.ts`, `tests/aac-phrases.test.ts` |
| FHIR R4 mapping | Mapping only, no server | `src/lib/care/fhir.ts`, `tests/care-fhir.test.ts` |
| Demo dataset depth | 22 synthetic patients (`pt_0001`–`pt_0022`), each `synthetic: true`, deep charts; 8 new (`pt_0015`–`pt_0022`) with ≥2 seeded docs each | `src/lib/care/seedPatients.ts`, `src/lib/care/seedDemo.ts`, `tests/demo-dataset.test.ts` |
| Chart-grounded questions | Deterministic generator (`buildChartQuestions`, `chartQuestionStrings`) wired into `portalBrain.suggestionsFor` and `assistant.suggestedQuestions` | `src/lib/care/demoQuestions.ts` |
| Console PHI | Removed message body from `/api/notify` log | `src/app/api/notify/route.ts` |
| Docs | `docs/DEMO_QUESTION_BANK.md`, `docs/VERCEL_PRODUCTION_DEPLOYMENT.md`, `docs/SMALL_MODEL_TASK_LIST.md`, reconciled security/roadmap/RAG docs | committed |

Verification: `npm run typecheck` clean; `npx vitest run` = 55 files / 856 tests; `npm run build` = "Compiled successfully"; `npm run eval:rag` recall@5 = 0.957, MRR = 0.891; backend `pytest` = 534 passed.

## 2. Implemented but not verified

- Multi-instance Redis behaviour (no Redis credentials) — driver selected but not exercised across instances.
- Real Gemini answer path (no `GEMINI_API_KEY`) — rules-based fallback exercised only.
- Real MSG91 SMS/WhatsApp dispatch (no credentials) — dispatch path unit-tested, provider not called.
- Real Exotel/Twilio telephony webhooks — mock provider exercised; carrier webhooks fail-closed by design.
- Hosted deploy (no Vercel credentials) — no deploy performed; `vercel.json` is the source of truth.

## 3. Investigated but not implemented (with reasons)

- **P1-3 speech-rate/dwell UI** — `saveTTSConfig` exists but is never called from a component; needs a settings UI. Deferred to smaller model / future pass (medium effort, low risk).
- **F6 CSRF token** — mitigated by `SameSite=Lax` cookie; a full double-submit token requires middleware; deferred.
- **F7 CSP tightening** — current CSP permits inline/eval and arbitrary origins by design (MediaPipe WASM from cdn, LAN HTTP cameras). Tightening risks breaking the demo; documented as trade-off.
- **F8 throttle extension** — driver-backed when Redis configured; notify/ingest maps remain per-instance. Extending requires refactor; deferred.
- **F9 TwiML secret** — derived from Twilio auth token when configured; open only in unconfigured local demo (by design).
- **F10 at-rest / tenant isolation** — answer cache keys now include full chart; KV store has no per-tenant namespace; deferred (no multi-tenant requirement in demo).
- **F11 console.log PHI** — fixed (body removed).
- **F13 host-header hardening on `/api/network-info`** — mitigated by strict-mode nurse auth; demo mode open by design.
- **P1-4 Indic translation** — gated on license review (IndicF5 has no license); design documented.
- **P0-7 full close** — needs a server-issued registration nonce; partial mitigation shipped.

## 4. Blocked by credentials or hardware

- Vercel deploy (no CLI auth / credentials).
- GPU/reliable hardware, camera/mic — real ASR/TTS latency and CV benchmarks impossible.
- Redis, Twilio, Gemini, MSG91, Exotel credentials — multi-instance and outbound paths unverified.
- Real patient data — none available; all data synthetic.

## 5. Recommended future work

1. Implement P1-3 speech-rate/dwell UI (smaller model or next pass).
2. Add a server-issued registration nonce to fully close P0-7.
3. Extend the driver-backed throttle to notify/ingest (F8).
4. Add a double-submit CSRF token via middleware (F6).
5. License review for IndicF5 before any Indic TTS work (P1-4).
6. Run a real Vercel deploy once credentials are available and update
   `docs/VERCEL_PRODUCTION_DEPLOYMENT.md` with the live URL.
7. Backend `/demo/patients` endpoint + tests (see `docs/SMALL_MODEL_TASK_LIST.md`).

## 6. Remotes

- `origin` = `https://github.com/MohammedAnasuddinZaid/Aarohan-2.0.git` (pushed, verified).
- `old-origin`, `voicelink`, `web2build` kept for reference; never touched.
- No force-push; no remote added/removed/renamed.
