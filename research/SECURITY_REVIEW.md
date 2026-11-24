# Security Review — CareSpeak

Read-only source review. No code was changed to produce this document.

| Item | Value |
|---|---|
| Reviewed commit | `ed03dc54ab8babdbeeedf92bfd84c02b28fa98b7` (2026-11-24, this session) |
| Previous review | `148295de1bb248fb74056253800ed34f969476a6` — findings F1–F13 were reported `OPEN` at that commit |
| Repository | `MohammedAnasuddinZaid/Aarohan-2.0` (remote `origin`) |
| License | MIT — `LICENSE` in-repo; GitHub API `license.spdx_id: MIT` for the `origin` repo |
| Method | Static reading of route handlers, auth helpers, service worker, Next.js config, and the FastAPI backend; matching every claim against the code that actually runs |
| External testing | **None.** No penetration test, no fuzzing, no dynamic exploitation was performed |

> This review states what the code enforces. It makes **no HIPAA / GDPR / DPDP or
> any other compliance claim**, and it is not a substitute for an external
> penetration test. Every finding below is a code-reading result at the commit
> above; runtime behaviour under a real deployment (TLS termination, proxy
> rewrites, DNS, container filesystem) was **not** exercised and is marked
> `UNVERIFIED` where it matters.

---

## Status update (commit `ed03dc5`, this session)

The following findings from §3 have been addressed in code and are covered by new
tests. They are recorded here so a reader does not have to re-discover them.

| Finding | Status | Evidence |
|---|---|---|
| F1 `/api/notify` unauthenticated dispatch | **FIXED** when a provider is configured; remains open in keyless demo | `src/app/api/notify/route.ts:63-66` (`requireProof = isStrictSecurity() \|\| Boolean(process.env.MSG91_AUTH_KEY)`) |
| F2 sync/stream data-plane IDOR | **FIXED in strict mode** (read + write plane require proof); demo stays open by design | `src/app/api/sync/route.ts`, `src/app/api/stream/route.ts` |
| F3 `/api/ward` open overview | **MITIGATED** — already strict-gated; enumeration closed by the strict default on hosted deployments | `src/app/api/ward/route.ts:21-26` |
| F4 tokenless ingest | **UNCHANGED** — still open in demo; requires `CARESPEAK_DEVICE_TOKEN` in strict | `src/app/api/ingest/route.ts` |
| F5 QR pre-registration seizure | **MITIGATED** — rotate now requires proof of the current token; register returns 409 on conflict; a nurse can reclaim; pairing writes are throttled per IP | `src/lib/server/pairing.ts`, `src/app/api/pair/route.ts` |
| F6 cookie CSRF / Secure | **UNCHANGED** | — |
| F7 CSP | **UNCHANGED** | — |
| F8 per-instance throttles | **PARTIAL** — new throttle is driver-backed when Redis is configured; notify/ingest maps remain per-instance | `src/lib/care/throttle.ts` |
| F9 optional TwiML secret | **UNCHANGED** | — |
| F10 at-rest / cache isolation | **PARTIAL** — answer cache keys now include vitals, finding severity+reading and the full chart; critical readings bypass the cache | `src/lib/care/portalBrain.ts` |
| F11 `console.log` PHI-adjacent | **UNCHANGED** | — |
| F12 dev_bypass / mock webhook | **UNCHANGED (by design)** | — |
| F13 network-info | **UNCHANGED** | — |

The §7 recommendation list is superseded: items 1–5 of it are now substantially
implemented (strict default on hosted deployments, proof-gated sync/stream/notify,
throttle in the shared store, pairing proof). Items 6–7 (TwiML secret as header,
CSP tightening) remain open.

---

## 1. Deployment posture: two modes

The web app is governed by an explicit switch, not `NODE_ENV`
(`src/lib/care/securityMode.ts:31-53`):

| Mode | How selected | What is open |
|---|---|---|
| `demo` (**default**) | unset, `CARE_SECURITY_MODE=demo`, or `CARE_DEMO_MODE` not `0` | ward board, escalation dispatch, tokenless device ingest, seeded `nurse.demo` account |
| `strict` | `CARE_SECURITY_MODE=strict` or `CARE_DEMO_MODE=0` | demo credentials refused; ward/notify need a login; ingest needs a token; LAN discovery disabled; sync data plane requires proof of pairing |

Only `CARE_NURSE_USER` **and** `CARE_NURSE_PASS` together replace the demo
account; a configured username with an unset password no longer falls back to
the literal `nurse.demo` (`src/lib/care/auth.ts:34-62`). `/api/health` reports
the active mode and every remaining demo affordance
(`src/lib/care/securityMode.ts:68-110`).

The Python backend has a separate posture: it binds loopback by default
(`backend/app/config.py:80`), requires dashboard auth by default
(`require_dashboard_auth`, `backend/app/config.py:198`), and when reached
through a public tunnel serves **only** `/api/telephony/*`
(`backend/app/main.py:76-94`, `VOICELINK_PUBLIC_SURFACE_TELEPHONY_ONLY` default
`true`, `backend/app/config.py:187-189`).

---

## 2. Endpoint & auth-mechanism inventory

### 2.1 Auth mechanisms

| Mechanism | Where defined | Strength |
|---|---|---|
| **Nurse cookie** `care_session` | `src/lib/care/auth.ts:18,127-132` | 32-byte random token, SHA-256 stored, `HttpOnly; SameSite=Lax`, 8 h TTL; `Secure` only when `NODE_ENV=production` |
| **Participant token** `x-care-participant` / `Authorization: Bearer` | `src/lib/care/auth.ts:19,119-125`; minted at join and stored as SHA-256 | 32-byte random; bound to one session (`findSessionByParticipantToken`, `src/lib/care/repo.ts:444-453`) |
| **QR pair token** | `src/lib/server/pairing.ts` | client-generated `[A-Za-z0-9_-]{8,64}` (`src/app/api/pair/route.ts:19-21`); first-writer-wins persistent record |
| **Device token** `x-device-token` | `src/app/api/ingest/route.ts:38-49` | equals `CARESPEAK_DEVICE_TOKEN` when set; **absent ⇒ open in demo mode** |
| **Telephony webhook secret** `k` | `src/lib/care/voice.ts:75-81`; checked at `src/app/api/care/voice/route.ts:67-70` | optional; **empty ⇒ guard skipped** when Twilio is unconfigured |
| **Backend session cookie / bearer** `voicelink_session` | `backend/app/auth.py:123-162` | scrypt password hashing, revocable server-side session; `dev_bypass` when `require_dashboard_auth` is false (`backend/app/auth.py:133-143`) |

### 2.2 Route inventory (web app)

| Route | Method | Guard | Mode-dependent | Evidence |
|---|---|---|---|---|
| `/api/ward` | GET | nurse cookie **only in strict** | open in demo | `src/app/api/ward/route.ts:21-26` |
| `/api/notify` | POST | `authorizeSyncSession`, `requireProof`=strict only | open in demo | `src/app/api/notify/route.ts:60-68` |
| `/api/ingest` | POST | device token, else open in demo | open in demo | `src/app/api/ingest/route.ts:38-49` |
| `/api/pair` | POST/GET | none (capability = the token itself) | always | `src/app/api/pair/route.ts:31-106` |
| `/api/sync` | GET/POST | `authorizeSyncSession` (proof only if registered) | open when unpaired | `src/app/api/sync/route.ts:52-53,89-90` |
| `/api/stream` | GET | `authorizeSyncSession` (proof only if registered) | open when unpaired | `src/app/api/stream/route.ts:34-37` |
| `/api/network-info` | GET | nurse cookie **only in strict**; disabled on Vercel | open in demo | `src/app/api/network-info/route.ts:24-36` |
| `/api/care/*` (sessions, patients, records, report, audit, tasks, assistant, agent, messages, transcript, signal, events, call, portal, phone/qr) | various | nurse cookie, and/or participant token bound to the exact session | enforced | `src/lib/care/auth.ts:108-125`; binding e.g. `src/app/api/care/transcript/route.ts:28-33`, `src/app/api/care/sessions/[id]/route.ts:28-35`, `src/app/api/care/signal/route.ts:16-28` |
| `/api/care/voice` | GET/POST | optional `k` secret | skipped when Twilio unconfigured | `src/app/api/care/voice/route.ts:67-71` |
| `/api/care/auth/login` | POST | rate-limit pre-check | always | `src/app/api/care/auth/login/route.ts:21-24`; `src/lib/care/loginRateLimit.ts` |

`/api/care/portal` and `/api/care/call` correctly treat a bare session id as
**not** a capability: they call `authorizeSession` (nurse cookie or verified pair
only), `src/app/api/care/portal/route.ts:54-65`, `src/app/api/care/call/route.ts:58`.

---

## 3. Findings

Severity reflects the impact **in the mode the finding applies to**. Status is
`OPEN` (present at the reviewed commit) or `FIXED` (verified in code at this
commit; note these were fixed before this review, not by it).

### F1 — HIGH — Unauthenticated escalation dispatch (`/api/notify`) [OPEN]

`src/app/api/notify/route.ts:60-68` calls
`authorizeSyncSession(req, session, pair, { requireProof: isStrictSecurity() })`.
In the default demo mode `requireProof` is `false`, and
`authorizeSyncSession` returns `{ allowed: true }` for any session that has not
registered a pair token (`src/lib/care/sessionAccess.ts:88`). The contacts are
taken straight from the request body and only format-filtered
(`/api/notify/route.ts:84`), then used to POST to MSG91
(`/api/notify/route.ts:89-102`).

Impact: an unauthenticated caller can trigger real paid SMS/WhatsApp to up to
5 arbitrary numbers, with a server-built message naming an attacker-chosen
`patient` string and a spoofed "EMERGENCY" (`/api/notify/route.ts:70-87`). This
is both cost abuse and a forged clinical alert. The per-instance cooldown
(`lastSent`, `/api/notify/route.ts:7-9,77-82`) is bypassable across serverless
instances and by rotating sessions.

### F2 — HIGH — Session id is a bearer capability on the live data plane [OPEN]

`/api/sync` (read **and** write) and `/api/stream` (read) authorize with
`authorizeSyncSession` **without** `requireProof`
(`src/app/api/sync/route.ts:52-53,89-90`; `src/app/api/stream/route.ts:34-37`).
For any unregistered console — the default — a caller who supplies a session id
reads gesture entries, patient metrics, vitals and nurse replies, and can append
entries, metrics, vitals and replies. Session ids there are caller-chosen short
strings validated by `/^[A-Z0-9_-]{3,32}$/` (`/api/sync/route.ts:18-20`,
`/api/ingest/route.ts:63`), not high-entropy tokens. This is a cross-session
IDOR: one bed's console can read and alter another bed's live PHI and alerts.

The 30 s registration cache means a freshly paired bed can remain permissive for
up to 30 s (`src/lib/care/sessionAccess.ts:46-58,82-88`) — a documented, but
real, window.

### F3 — HIGH — Unauthenticated ward overview (`/api/ward`) [OPEN]

`src/app/api/ward/route.ts:21-26` guards only when `isStrictSecurity()`. In demo
mode any caller receives, for up to 50 recently active sessions: last gesture,
unacknowledged/escalated counts, alertness, movement, heart rate, SpO2, SOS
state, and pairing IP/last-scan (`/api/ward/route.ts:51-67`). That is a
cross-patient PHI dump with no authentication.

### F4 — HIGH/MEDIUM — Tokenless device ingest (`/api/ingest`) [OPEN]

When `CARESPEAK_DEVICE_TOKEN` is unset (the default) and the mode is demo,
`/api/ingest` accepts traffic with no credential
(`src/app/api/ingest/route.ts:38-49`). A caller can post `type:"sos"` to create
an `EMERGENCY` entry for **any** session, which fans out exactly like a real
patient gesture (`/api/ingest/route.ts:72-92`), or `type:"vitals"` to inject
heart rate / SpO2 / temperature (`/api/ingest/route.ts:95-101`). Spoofed SOS and
spoofed vitals are clinical-safety false signals. The SOS throttle is per-instance
(`lastSosAt`, `/api/ingest/route.ts:8-9,72-79`).

### F5 — HIGH/MEDIUM — Unauthenticated QR pair-token registration [OPEN]

`POST /api/pair {action:"register"}` has no authentication and is first-writer-wins
(`src/app/api/pair/route.ts:54-56`; `src/lib/server/pairing.ts:115-124` returns
`false` if a different token already exists). An attacker who knows or guesses a
session id can pre-register their own pair token and then: (a) use it to read the
session through `/api/sync`/`/api/stream`, and (b) permanently block the
legitimate console from registering (its `register` returns `false`). This is a
pairing hijack + denial-of-pairing. Guessing is feasible because the ids are
short, low-entropy strings rather than the 32-byte join tokens used by the care
app (`src/lib/care/crypto.ts:15-17`).

### F6 — MEDIUM — Nurse cookie has no CSRF token; `Secure` depends on `NODE_ENV` [OPEN]

`buildSessionCookie` sets `HttpOnly; SameSite=Lax` but no CSRF token, and marks
`Secure` only when `process.env.NODE_ENV === "production"`
(`src/lib/care/auth.ts:127-137`). `SameSite=Lax` blocks cross-site cookie POSTs
in current browsers, which mitigates classic CSRF, but there is no
`Origin`/double-submit check on state-changing care POST/PATCH routes, and a
deployment that runs non-production `NODE_ENV` over HTTPS will omit `Secure`.
Residual risk, not a break.

### F7 — MEDIUM — CSP permits inline/eval script and arbitrary network origins [OPEN]

`next.config.js:18-31`: `script-src 'self' 'unsafe-inline' 'unsafe-eval'
https://cdn.jsdelivr.net`; `connect-src ... http: https: ws: wss:`;
`img-src/media-src` allow `http:` and `https:`. The comments justify `http:` for
LAN MJPEG cameras, but the same policy lets injected script exfiltrate to any
origin and disables the main XSS benefit of CSP. No `Strict-Transport-Security`
header is set anywhere in `next.config.js:9-33`.

### F8 — MEDIUM — Rate-limit and throttle state is per-instance [OPEN]

`loginRateLimit.ts` is honest that its bucket is only distributed when Redis is
configured; without Redis it is process-local
(`src/lib/care/loginRateLimit.ts:1-12,56-72`). Separately, the throttle maps in
`/api/notify` (`lastSent`, `/api/notify/route.ts:9`) and `/api/ingest`
(`lastSosAt`, `/api/ingest/route.ts:9`) are route-local maps that reset on cold
start and never coordinate across instances — so on autoscaled/serverless
deployment those throttles are advisory. `clientIp` also trusts the first
`x-forwarded-for` value (`src/lib/care/loginRateLimit.ts:31-42`), which lets a
client that can set that header rotate buckets.

### F9 — MEDIUM — Optional webhook secret drops open when Twilio is unconfigured [OPEN]

`voiceSecret()` returns `""` when no explicit secret and no Twilio auth token is
present (`src/lib/care/voice.ts:75-81`); the TwiML handler then skips the check
entirely (`src/app/api/care/voice/route.ts:67-70`). With no carrier configured,
`GET`/`POST /api/care/voice?session=<id>` renders patient-grounded script text
(`voiceOpening`/`askPortal`), i.e. unauthenticated PHI disclosure in the
rules-only demo. The comment calls this deliberate for local use; it is a finding
the moment the route is internet-reachable. When a secret *is* configured it is
embedded in the callback URL (`buildWebhookUrl`), where it can leak through
carrier/proxy logs.

### F10 — MEDIUM — Data-at-rest and cache isolation [OPEN]

- Backend state is a single SQLite file with WAL (`backend/app/database.py:11,21,446-451`,
  `settings.db_path`). On an ephemeral/container filesystem this is lost on
  redeploy, and there is no built-in backup/retention job demonstrated here
  (`database.purge_older_than` exists but must be scheduled by the operator).
- The web KV namespace is global, not per-tenant (`care:*`, `src/lib/care/store.ts:360-394`):
  any process holding the Redis credentials reads every session. With the `file`
  driver the whole store is plaintext JSON under `CARE_DATA_DIR`
  (`src/lib/care/store.ts:106-127`), and with `memory` it is non-persistent
  (`src/lib/care/store.ts:46-95`). Driver choice is surfaced honestly to the UI
  (`src/lib/care/repo.ts:130-133`).
- Backend provider secrets are plaintext JSON with best-effort `0600`
  (`backend/app/secrets_store.py:1-11,67-71,91-111`); session secrets are
  generated locally if absent (`backend/app/secrets_store.py:138-145`).

### F11 — LOW — Alert text logged client-side [OPEN]

`/api/notify` logs the full dispatch message — patient label, gesture, and a
`nurse-view` URL — via `console.log` in demo mode
(`src/app/api/notify/route.ts:113-114`). It is the only application
`console.log` in `src/` found by search. With real data this writes PHI-adjacent
text to platform logs.

### F12 — LOW — Backend `dev_bypass` and mock-provider webhooks [OPEN / by design]

`current_user` returns an admin principal whenever
`require_dashboard_auth` is false (`backend/app/auth.py:133-143`); default is
`true` (`backend/app/config.py:198`), so this is a footgun, not a default
exposure. The mock telephony provider accepts any webhook body unless an
`x-mock-signature` header is supplied (`backend/app/telephony/mock.py:155-162`);
it is selected only when no real carrier is configured (`telephony_provider`
"auto" ⇒ Exotel, Twilio, then mock, `backend/app/config.py:164-167`).

### F13 — LOW — No LAN/host header hardening on `/api/network-info` in demo [OPEN]

`/api/network-info` returns `os.hostname()` and private IPv4 addresses to any
caller outside strict mode / Vercel (`src/app/api/network-info/route.ts:38-59`).

---

## 4. Controls verified as actually enforced (not aspirational)

- **Pair auth on the care app is real.** `authorizeSession` accepts only a nurse
  cookie or a *verified* pair token; a bare session id is explicitly rejected
  (`src/lib/care/sessionAccess.ts:30-44`).
- **Participant tokens are scoped to one session** and old tokens are invalidated
  on re-join (`src/lib/care/repo.ts:444-453`). Every patient-facing care route
  compares `viaParticipant.id !== session.id` and 401s on mismatch
  (`transcript`, `messages`, `sessions/[id]`, `signal`, `events`).
- **Service-worker PHI caching is correctly suppressed.** Clinical prefixes
  (`/api/`, `/care`, `/nurse-view`, `/ward`, `/dashboard`, `/logs`, `/report`,
  `/cctv`) are matched by prefix and never read or written to Cache Storage;
  offline they fail rather than render stale data (`public/sw.js:16-34,62-63`).
  The v2 cache that had cached `/nurse-view`, `/logs`, `/report` is deleted on
  activate (`public/sw.js:45-54`).
- **Login throttling works** where the store is shared, hashes the
  `ip|username` key so no raw PII is persisted, and clears on success
  (`src/lib/care/loginRateLimit.ts:44-93`;
  `src/app/api/care/auth/login/route.ts:21-24`).
- **Remote TTS is opt-in only** — the Google `translate_tts` fallback is off
  unless `NEXT_PUBLIC_CARE_REMOTE_TTS=1` (`src/lib/care/securityMode.ts:96-100`).
- **Backend webhook verification fails closed.** `verify()` raises
  `WebhookRejected` unless the provider verifies (`backend/app/telephony/webhooks.py:51-62`);
  Twilio rejects when the signature or auth token is missing
  (`backend/app/telephony/twilio.py:250-254`); Exotel rejects when its secret is
  unconfigured (`backend/app/telephony/exotel.py:325-344`). Replay is bounded
  (`ReplayGuard`, `backend/app/telephony/webhooks.py:84-112`).
- **Backend network exposure is narrowed**: loopback bind, localhost/RFC1918-only
  CORS with a regex a public origin cannot satisfy
  (`backend/app/config.py:137-149`), loopback-only service URLs enforced at
  import (`backend/app/security.py:221-240`), and public tunnels restricted to
  `/api/telephony/*` (`backend/app/main.py:76-94`).
- **Input hardening**: clinical-range clamping and NaN rejection on metrics and
  vitals (`src/app/api/sync/route.ts:109-134`), gesture whitelisting
  (`src/app/api/notify/route.ts:72`), phone-format filtering with a 5-contact cap
  (`src/app/api/notify/route.ts:84`), TwiML XML escaping
  (`src/lib/care/voice.ts:90-100`), and control-character stripping on the
  backend (`backend/app/security.py:11-16,60-77`).
- **Standard security headers** are set (`X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) at
  `next.config.js:10-16`.

Status summary: F1–F5, F7–F11, F13 `OPEN`; F6 is a residual/design gap; F12 is
by-design but documented. The three controls the prior audit listed as "fixed
this pass" are confirmed FIXED in code: pair-gated sync/stream for registered
beds (`sessionAccess.ts:88-104`), login throttling (`loginRateLimit.ts`), and
remote-TTS default-off (`securityMode.ts:96-100`).

---

## 5. Explicit coverage of requested topics

| Topic | Verdict |
|---|---|
| Cross-session IDOR | Care app: **not present** — participant tokens are session-bound. Sync/stream/ward/notify/ingest data plane in demo mode: **present** (F2, F3, F4). |
| Cache isolation | Service worker: **correctly excluded** for clinical routes. KV store: **global namespace**, no per-tenant isolation (F10). |
| Service-worker PHI caching | **Not happening** — private prefixes bypass the cache entirely; prior bad caches are purged (F4 evidence under §4). |
| Webhook forgery | Backend carrier webhooks **fail closed** (Twilio/Exotel). Mock accepts any body by design. Next.js TwiML webhook secret is **optional** (F9). |
| CORS | Backend: localhost+RFC1918 regex only, credentials on (`config.py:137-149`). Web app: no CORS layer needed (same-origin). |
| CSP | Present but weak: inline/eval allowed, arbitrary `http(s)`/`ws(s)` connect (F7); no HSTS. |
| Secrets in logs | Provider secrets never logged; no PII in the login rate key. One PHI-adjacent `console.log` in `/api/notify` (F11); webhook secret is embedded in a URL (F9). |
| SQLite on ephemeral FS | Single-file WAL SQLite; persistence/retention is operator-dependent (F10). |
| Per-instance rate-limit limits | Acknowledged in code; not distributed without Redis (F8). |

---

## 6. Not covered / UNVERIFIED

- **No external penetration test, no fuzzing, no exploit reproduction.** All
  findings are static-reading results.
- **No compliance certification is claimed or implied** (no HIPAA, GDPR, DPDP,
  or clinical-SLA claim).
- **Runtime/TLS/deployment behaviour is UNVERIFIED here**: reverse-proxy header
  rewriting (`x-forwarded-*`), true `Secure` cookie enforcement, container
  filesystem persistence, and Cloudflare-tunnel routing were not exercised.
- **Dependency and supply-chain risk is UNVERIFIED** — no `npm audit`/`pip
  audit`, CVE scan, or lockfile review was performed in this pass.
- **The frontend `memory`/`file` driver path was read, not run.**
- **`/api/care/report/[id]` and `/api/care/patients/[id]` are nurse-wide**
  (any signed-in nurse reads any report/patient). In a single-clinic deployment
  that is intended; in a multi-tenant one it would be horizontal privilege
  escalation. Not scored as a finding because the product model is one clinic.
- Line numbers refer to the reviewed commit; later edits will shift them.

---

## 7. Recommended posture (not implemented in this pass)

1. Flip the default to `strict` and require every client to present a pair token
   or nurse cookie; keep `demo` as an explicit opt-in
   (`securityMode.ts:31-39`).
2. Require proof of pairing (or a nurse cookie) for `/api/notify`, `/api/ward`,
   `/api/sync`, `/api/stream`, `/api/ingest` unconditionally, not only in strict
   mode.
3. Authenticate `/api/pair` `register` with a server-issued session secret, and
   issue high-entropy session ids rather than caller-chosen short strings.
4. Add an `Origin` check / CSRF token to state-changing care routes and always
   set `Secure` when served over TLS (`auth.ts:127-137`).
5. Move the notify/ingest throttles into the shared store; never trust
   `x-forwarded-for` unless the trusted proxy overwrites it.
6. Require the TwiML webhook secret unconditionally, and pass it as a header or
   POST field rather than a URL query parameter.
7. Tighten CSP: drop `'unsafe-eval'` if feasible, replace blanket `http(s)` connect
   with an explicit allow-list, and add `Strict-Transport-Security` when served
   over HTTPS.
