import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as pairPost, GET as pairGet } from "@/app/api/pair/route";
import { POST as notifyPost } from "@/app/api/notify/route";
import { buildSessionCookie, login } from "@/lib/care/auth";
import {
  registerPairTokenPersistent,
  resetPairingForTests,
  verifyPairTokenPersistent,
} from "@/lib/server/pairing";
import { resetDriverForTests } from "@/lib/care/store";
import { resetSessionAccessForTests } from "@/lib/care/sessionAccess";

const SESSION = "BED12";

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function nurseCookie(): Promise<string> {
  const outcome = await login("nurse.demo", "nurse.demo");
  return buildSessionCookie(outcome!.token).split(";")[0];
}

beforeEach(() => {
  resetDriverForTests();
  resetPairingForTests();
  resetSessionAccessForTests();
  delete (globalThis as unknown as { __carespeakPairing?: unknown }).__carespeakPairing;
  delete process.env.MSG91_AUTH_KEY;
});

describe("POST /api/pair — rotation is proof-gated", () => {
  it("rejects a rotate that cannot prove the current token, leaving the bed intact", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await pairPost(post("https://care.example.com/api/pair", {
      action: "rotate",
      session: SESSION,
      pair: "attacker-token-99",
    }));
    expect(res.status).toBe(403);
    expect(await verifyPairTokenPersistent(SESSION, "owner-token-1234")).toBe(true);
    expect(await verifyPairTokenPersistent(SESSION, "attacker-token-99")).toBe(false);
  });

  it("rejects a wrong proof too", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await pairPost(post("https://care.example.com/api/pair", {
      action: "rotate",
      session: SESSION,
      pair: "attacker-token-99",
      proof: "guess",
    }));
    expect(res.status).toBe(403);
    expect(await verifyPairTokenPersistent(SESSION, "owner-token-1234")).toBe(true);
  });

  it("allows a rotate that proves possession of the current token", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await pairPost(post("https://care.example.com/api/pair", {
      action: "rotate",
      session: SESSION,
      pair: "rotated-token-5678",
      proof: "owner-token-1234",
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; pair: string };
    expect(body.ok).toBe(true);
    expect(body.pair).toBe("rotated-token-5678");
    expect(await verifyPairTokenPersistent(SESSION, "rotated-token-5678")).toBe(true);
    expect(await verifyPairTokenPersistent(SESSION, "owner-token-1234")).toBe(false);
  });

  it("lets a signed-in nurse recover a bed without proof", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await pairPost(
      post(
        "https://care.example.com/api/pair",
        { action: "rotate", session: SESSION, pair: "nurse-recovered-1" },
        { cookie: await nurseCookie() }
      )
    );
    expect(res.status).toBe(200);
    expect(await verifyPairTokenPersistent(SESSION, "nurse-recovered-1")).toBe(true);
  });

  it("404s a rotate for a session that was never paired", async () => {
    const res = await pairPost(
      post("https://care.example.com/api/pair", { action: "rotate", session: "NOPE01", pair: "x-token-1234" })
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/pair — registration cannot silently steal a bed", () => {
  it("409s a conflicting token and does not overwrite", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await pairPost(post("https://care.example.com/api/pair", {
      action: "register",
      session: SESSION,
      pair: "attacker-token-99",
    }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("already_paired");
    expect(await verifyPairTokenPersistent(SESSION, "owner-token-1234")).toBe(true);
  });

  it("is idempotent for the owner's own token", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await pairPost(post("https://care.example.com/api/pair", {
      action: "register",
      session: SESSION,
      pair: "owner-token-1234",
    }));
    expect(res.status).toBe(200);
  });

  it("lets a signed-in nurse reclaim a bed", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await pairPost(
      post(
        "https://care.example.com/api/pair",
        { action: "register", session: SESSION, pair: "nurse-reclaim-22" },
        { cookie: await nurseCookie() }
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reclaimed?: boolean };
    expect(body.reclaimed).toBe(true);
    expect(await verifyPairTokenPersistent(SESSION, "nurse-reclaim-22")).toBe(true);
  });

  it("GET still reports registration status", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await pairGet(new NextRequest(`https://care.example.com/api/pair?session=${SESSION}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; registered: boolean };
    expect(body.registered).toBe(true);
  });
});

describe("POST /api/notify — proof required when a provider is configured", () => {
  it("refuses an anonymous dispatch once MSG91 is configured", async () => {
    process.env.MSG91_AUTH_KEY = "live-key";
    const res = await notifyPost(post("https://care.example.com/api/notify", {
      session: SESSION,
      gesture: "EMERGENCY",
      contacts: ["+911234567890"],
    }));
    expect(res.status).toBe(401);
  });

  it("stays open (logging-only) in keyless demo mode", async () => {
    const res = await notifyPost(post("https://care.example.com/api/notify", {
      session: SESSION,
      gesture: "EMERGENCY",
      contacts: [],
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; provider: string };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("logging-only");
  });
});
