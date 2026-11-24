import type { NextRequest } from "next/server";
import { appendAudit } from "@/lib/care/repo";
import { buildSessionCookie, DEMO_CREDENTIALS_WARNING, login } from "@/lib/care/auth";
import { fail, ok, readBody } from "@/lib/care/http";
import {
  clearLoginRateLimit,
  clientIp,
  loginRateKey,
  peekLoginRateLimit,
  recordLoginFailure,
} from "@/lib/care/loginRateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await readBody<{ username?: string; password?: string }>(req);
  const username = (body?.username ?? "").trim();
  const password = body?.password ?? "";
  if (!username || !password) return fail("Enter a username and password.", 400);

  // Throttle before verifying credentials so a wrong password and an unknown
  // username cost the same and neither can be brute-forced cheaply.
  const rateKey = loginRateKey(clientIp(req.headers), username);
  const rate = await peekLoginRateLimit(rateKey);
  if (!rate.allowed) {
    const res = fail("Too many sign-in attempts. Try again later.", 429, {
      retryAfterMs: rate.retryAfterMs,
    });
    res.headers.set("Retry-After", String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))));
    return res;
  }

  const outcome = await login(username, password);
  if (!outcome) {
    await recordLoginFailure(rateKey);
    await appendAudit({ actorRole: "anonymous", action: "auth.login_failed", detail: { username } });
    return fail("Incorrect username or password.", 401);
  }

  await clearLoginRateLimit(rateKey);

  await appendAudit({
    actorRole: outcome.record.role,
    actorId: outcome.record.userId,
    action: "auth.login",
    detail: { username: outcome.record.username },
  });

  const demoWarning =
    outcome.record.username === "nurse.demo" && username === "nurse.demo" ? DEMO_CREDENTIALS_WARNING : undefined;

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        userId: outcome.record.userId,
        username: outcome.record.username,
        displayName: outcome.record.displayName,
        role: outcome.record.role,
      },
      warning: demoWarning,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Set-Cookie": buildSessionCookie(outcome.token),
      },
    }
  );
}

export async function GET() {
  return ok({ message: "POST username and password to sign in." });
}
