import { NextRequest, NextResponse } from "next/server";
import {
  registerPairTokenPersistent,
  rotatePairTokenPersistent,
  forceRotatePairTokenPersistent,
  recordScan,
  getPairSummary,
  getScans,
  verifyPairTokenPersistent,
  hasRegistrationPersistent,
} from "@/lib/server/pairing";
import { nurseFromRequest } from "@/lib/care/auth";
import { clientIp } from "@/lib/care/loginRateLimit";
import { checkThrottle, recordThrottleHit } from "@/lib/care/throttle";

export const dynamic = "force-dynamic";

/**
 * Pairing writes are capability-changing. A limit per client IP blunts the
 * enumeration/flooding vector behind P0-7 (an attacker pre-registering bogus
 * tokens for every bed id listed by the open ward board). Generous enough that
 * a console mounting once per bed is never affected.
 */
const PAIR_WRITE_POLICY = { limit: 30, windowMs: 60_000 };

function valid(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9_-]{3,32}$/.test(s.toUpperCase());
}

/** Pairing secrets are client-generated; require enough entropy to be one. */
function validPair(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(token);
}

/**
 * QR pairing + scan tracking.
 *
 * POST { action: "register", session, pair }        — patient console mounts
 * POST { action: "rotate",   session, pair }        — regenerate the QR token
 * POST { action: "scan",     session, pair, role? } — a device just scanned the QR
 * GET  /api/pair?session=X&pair=T                   — pairing status + scan log
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    session?: string;
    pair?: string;
    /** Proof of the CURRENT token, required to rotate an already-paired bed. */
    proof?: string;
    role?: string;
  } | null;

  if (!body || !valid(body.session)) {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 400 });
  }
  const session = body.session.toUpperCase();
  const pair = typeof body.pair === "string" ? body.pair : "";

  // A trivially guessable token would defeat the capability model.
  if (body.action !== "register" && body.action !== "rotate" && body.action !== "scan") {
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }
  if (!validPair(pair)) {
    return NextResponse.json({ ok: false, error: "Invalid pairing token" }, { status: 400 });
  }

  if (body.action === "register" || body.action === "rotate") {
    const ip = clientIp(req.headers);
    const status = await checkThrottle("pair", ip, PAIR_WRITE_POLICY);
    if (!status.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many pairing attempts. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(status.retryAfterMs / 1000)) } }
      );
    }
    await recordThrottleHit("pair", ip, PAIR_WRITE_POLICY);
  }

  switch (body.action) {
    case "register": {
      const ok = await registerPairTokenPersistent(session, pair);
      if (ok) return NextResponse.json({ ok: true, serverTime: Date.now() });
      // A second register with the SAME token is an idempotent re-affirm.
      if (await verifyPairTokenPersistent(session, pair)) {
        return NextResponse.json({ ok: true, serverTime: Date.now() });
      }
      // A different token already owns this bed. A signed-in nurse may reclaim
      // it; otherwise the console must be told (its alert link is paired to
      // another device), never silently "succeed".
      if (await nurseFromRequest(req)) {
        const token = await forceRotatePairTokenPersistent(session, pair);
        if (token) return NextResponse.json({ ok: true, reclaimed: true, serverTime: Date.now() });
      }
      return NextResponse.json(
        { ok: false, error: "This bed is already paired to another device.", reason: "already_paired" },
        { status: 409 }
      );
    }
    case "rotate": {
      // Recovery path: a signed-in nurse can always rotate a bed.
      if (await nurseFromRequest(req)) {
        const token = await forceRotatePairTokenPersistent(session, pair || undefined);
        if (!token) return NextResponse.json({ ok: false, error: "Not registered" }, { status: 404 });
        return NextResponse.json({ ok: true, pair: token, serverTime: Date.now() });
      }
      // The patient console generates the replacement token locally (so its QR
      // can re-render immediately) and MUST prove it holds the current token.
      const outcome = await rotatePairTokenPersistent(
        session,
        pair || undefined,
        typeof body.proof === "string" ? body.proof : null
      );
      if (!outcome.ok) {
        return NextResponse.json(
          {
            ok: false,
            error:
              outcome.reason === "forbidden"
                ? "Proof of the current pairing token is required to rotate it."
                : "Not registered",
          },
          { status: outcome.reason === "forbidden" ? 403 : 404 }
        );
      }
      return NextResponse.json({ ok: true, pair: outcome.token, serverTime: Date.now() });
    }
    case "scan": {
      if (!(await verifyPairTokenPersistent(session, pair))) {
        return NextResponse.json({ ok: false, error: "Invalid pairing token" }, { status: 403 });
      }
      const scan = recordScan(
        session,
        pair,
        (body.role ?? "nurse").replace(/[^a-z]/gi, "").slice(0, 16) || "device",
        req.headers.get("user-agent"),
        req.headers
      );
      if (!scan) return NextResponse.json({ ok: false, error: "Invalid pairing token" }, { status: 403 });
      return NextResponse.json({ ok: true, summary: getPairSummary(session), serverTime: Date.now() });
    }
    default:
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("session");
  if (!raw || !valid(raw)) {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 400 });
  }
  const session = raw.toUpperCase();
  const pair = searchParams.get("pair") ?? "";
  // Scan details require the pairing token; the anonymous summary is harmless.
  const authorized = pair.length > 0 && (await verifyPairTokenPersistent(session, pair));
  return NextResponse.json(
    {
      ok: true,
      registered: await hasRegistrationPersistent(session),
      summary: getPairSummary(session),
      ...(authorized ? { scans: getScans(session) } : {}),
      serverTime: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
