import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/care/auth/login/route";
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  clearLoginRateLimit,
  clientIp,
  loginRateKey,
  peekLoginRateLimit,
  recordLoginFailure,
} from "@/lib/care/loginRateLimit";
import { resetDriverForTests } from "@/lib/care/store";

function loginRequest(username: string, password: string, ip = "203.0.113.9"): NextRequest {
  return new NextRequest("https://care.example.com/api/care/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ username, password }),
  });
}

beforeEach(() => {
  resetDriverForTests();
});

describe("login rate limit helpers", () => {
  it("does not expose the raw IP or username in the key", () => {
    const key = loginRateKey("203.0.113.9", "Nurse.Demo");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.9");
    expect(key).not.toContain("nurse");
  });

  it("allows attempts until the window is exhausted, then blocks with a retry hint", async () => {
    const key = loginRateKey("203.0.113.9", "nurse.demo");
    const now = 1_700_000_000_000;

    expect(await peekLoginRateLimit(key, now)).toMatchObject({ allowed: true, remaining: LOGIN_MAX_ATTEMPTS });

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      await recordLoginFailure(key, now);
    }

    const blocked = await peekLoginRateLimit(key, now + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(LOGIN_WINDOW_MS - 1000);

    // A new window starts clean.
    expect((await peekLoginRateLimit(key, now + LOGIN_WINDOW_MS)).allowed).toBe(true);
  });

  it("clears the bucket after a successful sign-in", async () => {
    const key = loginRateKey("203.0.113.9", "nurse.demo");
    await recordLoginFailure(key);
    await clearLoginRateLimit(key);
    expect(await peekLoginRateLimit(key)).toMatchObject({ allowed: true, remaining: LOGIN_MAX_ATTEMPTS });
  });

  it("reads the first forwarded address, then falls back", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("POST /api/care/auth/login", () => {
  it("returns 429 after repeated failures from the same address", async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      const res = await POST(loginRequest("nurse.demo", "wrong"));
      expect(res.status).toBe(401);
    }

    const blocked = await POST(loginRequest("nurse.demo", "wrong"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const body = (await blocked.json()) as { ok: boolean; retryAfterMs: number };
    expect(body.ok).toBe(false);
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it("allows a valid sign-in and resets the failure bucket", async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++) {
      await POST(loginRequest("nurse.demo", "wrong"));
    }

    const success = await POST(loginRequest("nurse.demo", "nurse.demo"));
    expect(success.status).toBe(200);

    // The bucket was cleared, so a fresh wrong attempt is a normal 401 — not 429.
    const after = await POST(loginRequest("nurse.demo", "wrong"));
    expect(after.status).toBe(401);
  });

  it("keeps separate buckets per address so one attacker cannot lock out a ward", async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      await POST(loginRequest("nurse.demo", "wrong", "203.0.113.10"));
    }
    expect((await POST(loginRequest("nurse.demo", "wrong", "203.0.113.10"))).status).toBe(429);
    expect((await POST(loginRequest("nurse.demo", "nurse.demo", "203.0.113.11"))).status).toBe(200);
  });
});
