# Handoff Task List — Smaller Model

Handed off from the larger model after commits `56b60db` (origin/main). The
larger model implemented and verified the code changes below; the smaller model
owns **documentation** and **backend-lite** work only. Do not touch the Next.js
app's clinical logic without re-running the full test suite.

## What is already implemented and verified (do NOT redo)

- Security: `CARE_SECURITY_MODE=demo|strict`; strict default on Vercel;
  `/api/notify` proof-gating when MSG91 configured; QR rotation proof-gate +
  `/api/pair` 409 on conflict + nurse reclaim + per-IP throttle; constant-time
  device token; sync/stream read+write proof in strict mode; prompt-version cache
  invalidation + prompt-injection guard; answer cache correctness (vitals,
  finding severity+reading, full chart, critical bypass, 15-min TTL); service
  worker v3 never caches PHI pages; AAC phrase library English-only with EN
  badge; FHIR R4 mapping (mapping only, no server).
- Demo dataset: 22 synthetic patients (`pt_0001`–`pt_0022`), each `synthetic: true`,
  with deep charts + 2 seeded documents each for the new eight
  (`pt_0015`–`pt_0022`); `SYNTHETIC_SEED_VERSION = 4`,
  `RECORDS_SEED_VERSION = 3`.
- Chart-grounded question generator: `src/lib/care/demoQuestions.ts`
  (`buildChartQuestions`, `chartQuestionStrings`), wired into
  `portalBrain.suggestionsFor` and `assistant.suggestedQuestions`.
- Docs: `docs/DEMO_QUESTION_BANK.md`, `docs/VERCEL_PRODUCTION_DEPLOYMENT.md`,
  reconciled `research/SECURITY_REVIEW.md`, `research/IMPLEMENTATION_ROADMAP.md`,
  `research/RAG_CAG_ARCHITECTURE.md`.

## Verification baseline (must stay green)

- `npm run typecheck` — clean
- `npx vitest run` — 55 files / 856 tests
- `npm run build` — "Compiled successfully"
- `npm run eval:rag` — recall@5 ≈ 0.957, MRR ≈ 0.891
- Backend: `cd backend && .\.venv\Scripts\python.exe -m pytest -q` — 534 passed

## Tasks for the smaller model

### A. Documentation (no code)

1. **Update `research/IMPLEMENTATION_ROADMAP.md`** to reflect the new demo
   dataset + question bank as a completed item (add a row: "Demo dataset depth +
   chart-grounded questions — DONE — 22 patients, 856 tests"). Bump the test
   counts in any doc that still says 846/54 files.
2. **Write `docs/DEMO_WALKTHROUGH.md`** — a 5-minute judge-facing script:
   open `/ward`, pick `pt_0016` (dengue), show the platelet trend, ask
   "What is Priya's latest Platelet count reading, and how has it changed?",
   then `pt_0018` (chemo) for the allergy question, then `pt_0021` (paediatric
   asthma + peanut allergy) for the emergency path. Include the cross-patient
   questions from `docs/DEMO_QUESTION_BANK.md`.
3. **Reconcile the remaining untracked `research/*.md` files** (16 of them) —
   either commit them as-is with a one-line status header, or delete the stale
   ones. Do not invent new research claims. Verify every claim against source
   before keeping.
4. **Refresh `research/SECURITY_REVIEW.md` F-table** so F11 reads FIXED (console.log
   body removed) and F13 reads MITIGATED-or-UNCHANGED with a one-line reason.
5. **Add a "Demo data" section to `README.md`** (if it exists) pointing at
   `docs/DEMO_QUESTION_BANK.md` and stating all patients are synthetic.

### B. Backend-lite (Python, in `backend/`)

6. **Add a `/demo/patients` endpoint** to the FastAPI backend that returns the
   same 22 synthetic patients as the Next.js seed, so the backend can serve the
   demo without the frontend seed. Source of truth stays `src/lib/care/seedPatients.ts`;
   generate the JSON via a small script or hand-transcribe. Mark every record
   `synthetic: true`.
7. **Backend tests**: add pytest cases asserting the endpoint returns ≥ 22
   patients, every patient has ≥ 2 conditions and ≥ 2 medications, and every
   `patientId` referenced by seeded documents exists. Mirror
   `tests/demo-dataset.test.ts`.
8. **Keep `pytest` green** (534 + new). Run
   `cd backend && .\.venv\Scripts\python.exe -m pytest -q` and confirm.

### C. Do NOT do (blocked / out of scope)

- Do not deploy to Vercel (no credentials).
- Do not run real ASR/TTS latency or CV benchmarks (no GPU/camera/mic).
- Do not claim HIPAA/GDPR/DPDP compliance or clinical validation.
- Do not change `SYNTHETIC_SEED_VERSION` or `RECORDS_SEED_VERSION` without
  adding the new ids to `SYNTHETIC_ADDITION_IDS` (tombstones prevent
  resurrection of deleted patients).
- Do not approximate-match emergency/high-risk clinical queries.
- Do not share patient-specific cached responses across users.

### D. Verification commands (run before pushing)

```
npm run typecheck
npx vitest run
npm run build
npm run eval:rag
cd backend && .\.venv\Scripts\python.exe -m pytest -q
git push origin main
git ls-remote origin main   # must equal local HEAD
```

### E. Commit style

- One logical commit per task group (docs vs backend), PowerShell has no `&&`,
  so run git commands as separate statements.
- Push only to `origin`; never force-push; never touch remotes.
