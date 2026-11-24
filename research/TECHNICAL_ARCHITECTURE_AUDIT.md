# Technical Architecture Audit — CareSpeak

## 1. Stack (verified from package.json and source)

- Next.js 15.2 (App Router), React 19.1, TypeScript 5.8 (strict).
- Styling: Tailwind CSS 4.1.
- Vision: `@mediapipe/tasks-vision` 0.10 (WASM, on-device).
- Realtime: Server-Sent Events + adaptive polling fallback.
- Storage: Upstash Redis REST (`@upstash/redis`) with file and in-memory drivers.
- Search/RAG: `minisearch` 7.2 (deterministic, in-process).
- Charts: recharts 3.9.
- Tests: Vitest 3.0 (jsdom for frontend tests).
- Optional backend: FastAPI + SQLite + Whisper + Ollama (Python, not deployed).

## 2. Real-time data plane

- `src/app/api/stream/route.ts` — SSE push with `Last-Event-ID` resume,
  per-connection dedupe, adaptive hot/idle cadence (350ms → 2200ms).
- `src/app/api/sync/route.ts` — REST read (`GET`) + write (`POST`) for
  gestures, actions, metrics, vitals, replies. Reconciliation runs every
  500ms even while SSE is up (serverless cross-instance safety).
- `src/lib/networkSync.ts` — client orchestrates SSE, polling, outbox flush,
  BroadcastChannel fan-out to sibling tabs, status reporting.

## 3. Storage

- `src/lib/care/store.ts` — driver selection: Redis → file (local) → memory.
  Memory driver is process-local and resets on cold start; `/api/health`
  reports `driver` so the UI can warn.
- Keys are namespaced `care:*`. Append-only lists for events/transcripts/
  signalling with caps. `mutateDoc` provides read-modify-write.
- Redis driver uses REST; no persistent connections. Suitable for Vercel.

## 4. Offline

- `src/lib/outbox.ts` — IndexedDB queue (alert/action/metrics), latest-wins
  for metrics, FIFO otherwise.
- `src/lib/networkSync.ts` — flushes on `online`, Background Sync, explicit calls.
- Service worker (`public/sw.js`) caches shell; missing some care routes
  (see P1 list).

## 5. RAG / assistant

- `src/lib/care/retrieval.ts` — MiniSearch deterministic index with synonyms
  and typo tolerance; cached index.
- `src/lib/care/assistant.ts` — deterministic nurse Q&A + optional Gemini
  grounding. `src/lib/care/portalBrain.ts` (1520 lines) — portal assistant,
  SBAR, session linking.
- Gemini is optional; falls back to deterministic answers. Model cascade
  explicit (fast vs deep).

## 6. Testing

- 766 tests, 45 files, all passing. Covers classifiers, escalation, risk +
  Shapley, store concurrency, forecast, frontend TTS/audio/storage, sync,
  pairing, auth, access, routes, repo.
- No E2E tests (Playwright/Cypress not configured). No load tests.
- No clinical accuracy benchmarks.

## 7. Build / deploy

- `npm run build` succeeds. Next.js emits static + dynamic routes.
- Vercel-ready: `force-dynamic` on API routes, nodejs runtime for stream.
- Environment: `.env.example` documents all variables.

## 8. Coupling and hotspots

- `portalBrain.ts` is 1520 lines — single module owns context building,
  SBAR, linking, actions. Hard to test in isolation; covered by
  `portal-brain.test.ts`.
- `networkSync.ts` is ~500 lines with mixed concerns (SSE, poll, outbox, BC).
- Client-side session id generation means sessions are not server-registered;
  pairing is the only capability layer.
- In-memory registries (`lastSosAt`, `lastSent`, throttles) reset per lambda.

## 9. Scalability notes

- SSE holds a lambda open per client; Vercel function duration limits apply.
  Mitigated by adaptive cadence but not by a true pub/sub (Redis keyspace
  notifications not used).
- Pairing/registration cached in-process; cross-instance relies on Redis.
- No rate limiting on read endpoints beyond sync auth (added this pass).
- No CDN caching of API responses (`Cache-Control: no-store` everywhere).