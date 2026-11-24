# Scalability & Vercel Audit — CareSpeak

## Verified constraints

- Vercel Functions are stateless; in-memory state resets per instance.
- `getDriver()` auto-selects Redis → file → memory; on Vercel without Redis it
  degrades to memory (single-instance). `/api/health` reports this.
- SSE (`/api/stream`) holds a function open per client; adaptive cadence
  (350ms hot → 2200ms idle) reduces load but does not remove the open
  connection.
- Reconciliation polls every 500ms per client even while SSE is up (cross-
  instance safety). With Redis this is 2 extra reads per 500ms per client.
- Pairing/registration caches (added this pass) are per-instance, 30s TTL.

## Bottlenecks (analysis)

1. **No pub/sub.** Redis keyspace notifications or a managed realtime
   service (Ably/Pusher/Upstash Realtime) would replace per-client polling.
2. **Per-client SSE connections** do not scale to large wards on serverless.
   Consider a dedicated realtime service or WebSockets via a long-lived host.
3. **MiniSearch index is per-instance** and rebuilt from records; fine for
   small datasets, unverified at scale.
4. **Service worker** caches shell but not all care routes; offline cold-start
   may miss assets. Audit `public/sw.js`.
5. **No request rate limiting** on read endpoints beyond sync auth.

## Cost notes (UNVERIFIED)

- Upstash free tier limits (requests/day, storage) not measured here.
- Gemini and Twilio costs depend on usage; no budget guard in code beyond the
  notify 2-min throttle.

## Recommendations

- Add a load test (k6/Artillery) against `/api/sync` and `/api/stream` before
  claiming ward-scale support.
- Document Vercel function duration limits vs. SSE hold time.
- Add Upstash cost alerts.