# Vercel Production Deployment — CareSpeak

Status at commit `ed03dc5`: **not deployed**. No Vercel credentials or CLI auth
were available when this was written, so no deploy was performed and no claim of
a live deployment is made. `vercel.json` is in the repo and is the source of
truth for the function settings.

## Required environment variables

| Variable | Required? | Purpose |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | **Required on Vercel** | Shared store (`redis` driver). The `file`/`memory` drivers are not multi-instance and are not safe for a deployed, multi-device demo. `/api/health` reports the active driver. |
| `CARE_NURSE_USER` + `CARE_NURSE_PASS` | Required in strict mode | Replaces the seeded `nurse.demo` account. If only one is set, sign-in is disabled rather than falling back to the demo credential. |
| `CARESPEAK_DEVICE_TOKEN` | Recommended | Required by `/api/ingest` in strict mode. Without it, device ingest is refused. |
| `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_API_KEY`) | Optional | Enables the richer answer path in the nurse portal. Without it, answers are rules-based. |
| `MSG91_AUTH_KEY` + `MSG91_TEMPLATE_ID` | Optional | Enables real SMS/WhatsApp dispatch. With this set, `/api/notify` requires proof of pairing. |
| `CARE_SECURITY_MODE` | Optional | `strict` (default on Vercel) or `demo`. `CARE_DEMO_MODE=0` is an alias for strict. |
| `NEXT_PUBLIC_CARE_REMOTE_TTS` | Optional, default off | `1` sends text to Google `translate_tts`. Treat as PHI exposure. |

## Security posture on Vercel

`src/lib/care/securityMode.ts` selects `strict` automatically when `VERCEL` (or
`VERCEL_ENV=production`) is set, unless the operator explicitly sets
`CARE_SECURITY_MODE=demo`. In strict mode:

- Demo credentials are refused; ward/notify/ingest require a login or device
  token; LAN discovery is disabled; the sync read and write planes require proof
  of pairing (nurse cookie or a valid QR pair token).
- `/api/notify` requires proof whenever MSG91 is configured.
- `/api/ward` and `/api/network-info` require a nurse session.

Setting `CARE_SECURITY_MODE=demo` on a hosted deployment re-opens the demo
affordances on a public URL; `/api/health` advertises the active mode and
warnings so the posture can be checked from outside.

## Function settings

`vercel.json` sets `src/app/api/stream/route.ts` to `maxDuration: 60` (the SSE
stream must not be killed by the default 10 s limit). The rest use Next.js
defaults.

## What was verified vs. what was not

- Verified locally: `npm run typecheck`, `npx vitest run` (55 files / 856 tests),
  `npm run build`, `npm run eval:rag` (recall@5 = 0.957, MRR = 0.891), backend
  `pytest` (534 passed).
- **Not verified**: any real deployment, TLS, reverse-proxy header rewriting,
  Redis multi-instance behaviour, real MSG91 dispatch, real Gemini answers. Those
  need credentials and a real host.
- No deploy was performed in this pass.

## Do not claim

- That the app has been deployed to Vercel.
- Clinical validation, HIPAA/GDPR/DPDP compliance, or any certified SLA. CareSpeak
  is a hackathon demo with synthetic data.
